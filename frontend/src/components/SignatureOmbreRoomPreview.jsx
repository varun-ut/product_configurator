/**
 * SignatureOmbreRoomPreview.jsx
 *
 * Displays the room scene with embossed ombré panels tiled on the wall.
 * Room setup PNG is loaded automatically from public/images/room-setups/.
 * Black pixels in the room image become transparent (wall = panel zone).
 * Furniture renders on top of the panel wall.
 */

import React, { useRef, useEffect, useState, useCallback, memo } from 'react';

const ROOM_SETUP_URL = '/images/room-setups/Colour_Core_Setup.png';
const PREVIEW_SIZE = 680; // fixed px

const SignatureOmbreRoomPreview = ({ panelImage, panelCount = 3, className }) => {
  const wallRef = useRef(null);
  const overlayRef = useRef(null);
  const [overlayReady, setOverlayReady] = useState(false);

  // Load room setup image — decode off-screen first so the consumer paints
  // atomically. Until decode finishes, a loader covers the preview so the
  // user never sees the furniture pop in over the wall.
  useEffect(() => {
    let cancelled = false;
    const probe = new Image();
    probe.src = ROOM_SETUP_URL;
    probe.decode().catch(() => {}).finally(() => {
      if (cancelled) return;
      if (overlayRef.current) {
        overlayRef.current.src = ROOM_SETUP_URL;
      }
      setOverlayReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Tile panel image across wall canvas whenever it changes.
  // IMPORTANT: do NOT clear before the image loads — that causes the flicker.
  // We draw straight over the previous frame so there is no blank gap.
  const tileWall = useCallback(() => {
    const canvas = wallRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    if (!panelImage) {
      // No color picked yet — show a bare white wall behind the furniture.
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    const img = new Image();
    img.onload = () => {
      // Draw directly over the previous frame — the old tiles stay visible
      // right up until this draw call, eliminating the blank flash.
      const pw = Math.floor(W / panelCount);
      for (let i = 0; i < panelCount; i++) {
        ctx.drawImage(img, i * pw, 0, pw, H);
      }
    };
    img.src = panelImage;
  }, [panelImage, panelCount]);

  useEffect(() => { tileWall(); }, [tileWall]);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        flexShrink: 0,
        background: '#e8e4df',
        overflow: 'hidden',
      }}
    >
      {/* Layer 1: panel wall tiles */}
      <canvas
        ref={wallRef}
        width={2000}
        height={2000}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 }}
      />
      {/* Layer 2: room furniture / walls overlay (black→transparent) */}
      <img
        ref={overlayRef}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 3, pointerEvents: 'none' }}
      />
      {/* Layer 3: loader covers everything until furniture overlay is decoded */}
      {!overlayReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            zIndex: 10,
          }}
          data-testid="ombre-preview-loading"
        >
          <img src="/UV-loader.png" alt="Loading..." className="uv-loader" />
        </div>
      )}
    </div>
  );
};

// Memoised — props are panelImage (hook-managed), panelCount (literal) and
// className (literal), so a shallow compare skips re-renders from unrelated
// parent state changes.
export default memo(SignatureOmbreRoomPreview);
