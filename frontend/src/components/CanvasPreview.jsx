import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState, memo } from "react";
import { useRenderLog, logImageLoad, RENDER_DEBUG } from "@/hooks/use-render-log";
import { saveImageFile } from "@/lib/downloadImageFile";

const CanvasPreview = forwardRef(({ 
  backgroundImage, 
  textureColor,
  textureUrl, 
  selectedColor, 
  size, 
  isEmbossed,
  productType,
  onLoadingChange = null,
}, ref) => {
  useRenderLog("CanvasPreview", { backgroundImage, textureColor, textureUrl, selectedColor, size, isEmbossed, productType });

  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [bgLoaded, setBgLoaded] = useState(false);
  const [isLoadingNewTexture, setIsLoadingNewTexture] = useState(false);
  const bgImageRef = useRef(null);
  const currentTextureRef = useRef(null);
  const newTextureRef = useRef(null);
  const loadStartRef = useRef(0);
  const pendingTimerRef = useRef(null);
  const MIN_LOADING_MS = 400; // minimum spinner time in ms

  // Notify parent when loading state changes
  useEffect(() => {
    onLoadingChange?.(loading || isLoadingNewTexture);
  }, [loading, isLoadingNewTexture, onLoadingChange]);

  // Wall mask area - adjusted for the provided interior image
  // The wall is the dark area at the top of the image
  const WALL_MASK = {
    x: 0.0,
    y: 0.0,
    width: 1.0,
    height: 1.00
  };

  // Parse size to get tile dimensions for grid effect
  const getTileDimensions = useCallback(() => {
    if (!size) return { width: 80, height: 80 };
    const [w, h] = size.split('x').map(Number);
    const scale = 0.12;
    return { width: Math.max(w * scale, 60), height: Math.max(h * scale, 60) };
  }, [size]);

  // Load background image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const { onLoad: bgOnLoad, onError: bgOnError } = logImageLoad("BG image", backgroundImage);
    img.onload = () => {
      bgOnLoad();
      bgImageRef.current = img;
      setBgLoaded(true);
      setLoading(false);
    };
    img.onerror = () => {
      bgOnError();
      setLoading(false);
      setBgLoaded(true);
    };
    img.src = backgroundImage;
  }, [backgroundImage]);

  // Load texture image
  useEffect(() => {
    if (!textureUrl) {
      // Clear texture if no URL provided
      currentTextureRef.current = null;
      setIsLoadingNewTexture(false);
      return;
    }

    // Mark that we're loading a new texture
    setIsLoadingNewTexture(true);
    loadStartRef.current = Date.now();

    // clear any previous pending timer
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    let cancelled = false;
    const { onLoad: texOnLoad, onError: texOnError } = logImageLoad("Texture", textureUrl);
    img.onload = () => {
      if (cancelled) return; // a newer selection came in, discard this load
      texOnLoad();
      // Keep new image cached while enforcing minimum spinner duration
      newTextureRef.current = img;
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      if (remaining > 0 && RENDER_DEBUG) console.log(`%c⏳ [CANVAS] Texture loaded but spinner held for ${remaining}ms more (MIN_LOADING_MS)`, "color:#ffb74d");

      if (remaining > 0) {
        pendingTimerRef.current = setTimeout(() => {
          currentTextureRef.current = img;
          setIsLoadingNewTexture(false);
          pendingTimerRef.current = null;
        }, remaining);
      } else {
        currentTextureRef.current = img;
        setIsLoadingNewTexture(false);
      }
    };
    img.onerror = () => {
      if (cancelled) return;
      texOnError();
      const elapsed = Date.now() - loadStartRef.current;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      if (remaining > 0) {
        pendingTimerRef.current = setTimeout(() => {
          setIsLoadingNewTexture(false);
          pendingTimerRef.current = null;
        }, remaining);
      } else {
        setIsLoadingNewTexture(false);
      }
    };
    img.src = textureUrl;

    return () => {
      // Cancel this load — prevents stale images from overwriting newer selection
      cancelled = true;
      img.src = ""; // aborts the network request, releases browser memory
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [textureUrl]);

  // Render canvas
  const renderCanvas = useCallback(() => {
    if (RENDER_DEBUG) console.log("%c🎨 [CANVAS] renderCanvas()", "color:#ce93d8");
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const bgImg = bgImageRef.current;

    // Set canvas size
    const containerWidth = canvas.parentElement?.clientWidth || 900;
    const containerHeight = canvas.parentElement?.clientHeight || 600;
    
    const targetAspect = 16 / 9;
    let canvasWidth, canvasHeight;
    
    if (containerWidth / containerHeight > targetAspect) {
      canvasHeight = Math.min(containerHeight * 0.9, 650);
      canvasWidth = canvasHeight * targetAspect;
    } else {
      canvasWidth = Math.min(containerWidth * 0.95, 1100);
      canvasHeight = canvasWidth / targetAspect;
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Fill canvas background with white (change this color as needed)
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Calculate wall area
    const wallX = canvasWidth * WALL_MASK.x;
    const wallY = canvasHeight * WALL_MASK.y;
    const wallWidth = canvasWidth * WALL_MASK.width;
    const wallHeight = canvasHeight * WALL_MASK.height;

    // Determine the color to use
    let wallColor = textureColor || "#2d3748";
    if (productType === "vicstrip" && selectedColor) {
      wallColor = selectedColor;
    }

    // Draw wall texture/color
    ctx.save();
    
    // Draw texture image if available, otherwise use solid color
    if (currentTextureRef.current) {
      const textureImg = currentTextureRef.current;
      
      // Calculate dimensions to fit image in wall area while maintaining aspect ratio
      const imgAspect = textureImg.width / textureImg.height;
      const wallAspect = wallWidth / wallHeight;
      
      let drawWidth, drawHeight, drawX, drawY;
      
      // Scale factor - increase this to make image bigger (0.0 to 1.0)
      const scaleFactor = 1.0;
      
      if (imgAspect > wallAspect) {
        // Image is wider - fit to width
        drawWidth = wallWidth * scaleFactor;
        drawHeight = drawWidth / imgAspect;
      } else {
        // Image is taller - fit to height
        drawHeight = wallHeight * scaleFactor;
        drawWidth = drawHeight * imgAspect;
      }
      
      // Center the image
      drawX = wallX + (wallWidth - drawWidth) / 2;
      drawY = wallY + (wallHeight - drawHeight) / 2;
      
      ctx.drawImage(textureImg, 0, 0, textureImg.width, textureImg.height, drawX, drawY, drawWidth, drawHeight);
    } else {
      // Fallback to solid color
      ctx.fillStyle = wallColor;
      ctx.fillRect(wallX, wallY, wallWidth, wallHeight);
    }

    // Add tile grid lines for panel effect (only if no texture image)
    if (!currentTextureRef.current) {
      const tileDims = getTileDimensions();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
      ctx.lineWidth = 1;

      // Vertical lines
      for (let x = wallX; x <= wallX + wallWidth; x += tileDims.width) {
        ctx.beginPath();
        ctx.moveTo(x, wallY);
        ctx.lineTo(x, wallY + wallHeight);
        ctx.stroke();
      }

      // Horizontal lines
      for (let y = wallY; y <= wallY + wallHeight; y += tileDims.height) {
        ctx.beginPath();
        ctx.moveTo(wallX, y);
        ctx.lineTo(wallX + wallWidth, y);
        ctx.stroke();
      }
    }

    // Add emboss effect if enabled
    if (isEmbossed) {
      // Highlight effect
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(wallX, wallY, wallWidth, wallHeight);
      
      // Shadow for depth
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      for (let x = wallX; x < wallX + wallWidth; x += tileDims.width) {
        for (let y = wallY; y < wallY + wallHeight; y += tileDims.height) {
          ctx.fillRect(x + 2, y + 2, tileDims.width - 4, tileDims.height - 4);
        }
      }
    }

    // Add VicStrip groove pattern (only if no texture image)
    if (!currentTextureRef.current) {
      if (productType === "vicstrip") {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
        ctx.lineWidth = 2;
        
        // Vertical slat lines
        const slatWidth = 20;
        for (let x = wallX + slatWidth; x < wallX + wallWidth; x += slatWidth) {
          ctx.beginPath();
          ctx.moveTo(x, wallY);
          ctx.lineTo(x, wallY + wallHeight);
          ctx.stroke();
        }
      }
    }

    ctx.restore();

    // Draw background image (furniture) on top
    if (bgImg) {
      ctx.save();
      
      const furnitureY = canvasHeight * WALL_MASK.height;
      const furnitureHeight = canvasHeight - furnitureY;
      
      const srcY = bgImg.height * WALL_MASK.height;
      const srcHeight = bgImg.height - srcY;
      
      ctx.drawImage(
        bgImg,
        0, srcY, bgImg.width, srcHeight,
        0, furnitureY, canvasWidth, furnitureHeight
      );
      
      ctx.restore();
    }

    // Add subtle vignette
    const gradient = ctx.createRadialGradient(
      canvasWidth / 2, canvasHeight / 2, canvasHeight * 0.5,
      canvasWidth / 2, canvasHeight / 2, canvasHeight
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.1)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  }, [bgLoaded, textureColor, selectedColor, size, isEmbossed, productType, getTileDimensions]);

  // Re-render when texture finishes loading
  useEffect(() => {
    if (bgLoaded && !isLoadingNewTexture) {
      renderCanvas();
    }
  }, [isLoadingNewTexture, renderCanvas, bgLoaded]);

  // Re-render when dependencies change (but not while loading texture)
  useEffect(() => {
    if (bgLoaded && !isLoadingNewTexture) {
      renderCanvas();
    }
  }, [renderCanvas, bgLoaded, textureColor, selectedColor, size, isEmbossed, isLoadingNewTexture]);

  // Handle window resize (debounced to avoid thrashing on every pixel)
  useEffect(() => {
    let debounceTimer = null;
    const handleResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (bgLoaded && !isLoadingNewTexture) renderCanvas();
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [renderCanvas, bgLoaded, isLoadingNewTexture]);

  // Expose download function
  useImperativeHandle(ref, () => ({
    downloadImage: async (overrideFilename, addHeader) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let dataUrl = canvas.toDataURL("image/png", 1.0);
      if (addHeader) {
        try { dataUrl = await addHeader(dataUrl); }
        catch (err) { console.error("[CanvasPreview] header failed:", err); }
      }
      saveImageFile(dataUrl, overrideFilename || `univicoustic-design-${Date.now()}.png`);
    }
  }));

  return (
    <div className="relative w-full h-full flex items-center justify-center p-4" data-testid="canvas-container">
      <div className="relative w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className={`max-w-full max-h-full shadow-lg rounded-lg ${loading ? "invisible" : ""}`}
          style={{ background: "transparent" }}
          data-testid="preview-canvas"
        />
        {(loading || isLoadingNewTexture) && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: "#ffffff" }} data-testid="texture-loading">
            <img src="/UV-loader.png" alt="Loading..." className="uv-loader" />
          </div>
        )}
      </div>
    </div>
  );
});

CanvasPreview.displayName = "CanvasPreview";

// Wrap with memo so parent re-renders don't re-render the canvas
// unless its own props actually changed.
export default memo(CanvasPreview);
