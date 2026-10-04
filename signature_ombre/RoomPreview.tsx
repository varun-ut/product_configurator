/**
 * RoomPreview.tsx
 *
 * Displays the room scene with embossed ombré panels tiled on the wall.
 * Room setup PNG is loaded automatically from a fixed path.
 * Black pixels in the room image become transparent (wall = panel zone).
 * Furniture renders on top of the panel wall.
 */

'use client';

import React, { useRef, useEffect, useCallback } from 'react';

interface RoomPreviewProps {
  panelImage: string | null;
  panelCount?: number;
  className?: string;
}

const ROOM_SETUP_URL = '/images/room-setups/Colour_Core_Setup.png';

export const RoomPreview: React.FC<RoomPreviewProps> = ({
  panelImage,
  panelCount = 3,
  className,
}) => {
  const wallRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load room setup image as-is (no pixel manipulation — furniture stays intact)
  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.onload = () => { overlayRef.current!.style.display = 'block'; };
      overlayRef.current.src = ROOM_SETUP_URL;
    }
  }, []);

  // Tile panel image on wall whenever it changes
  const tileWall = useCallback(() => {
    const canvas = wallRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!panelImage) {
      ctx.fillStyle = '#d0c8c0';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const pw = Math.floor(W / panelCount);
      for (let i = 0; i < panelCount; i++) {
        ctx.drawImage(img, i * pw, 0, pw, H);
      }
    };
    img.src = panelImage;
  }, [panelImage, panelCount]);

  useEffect(() => { tileWall(); }, [tileWall]);

  // Resize room to fit viewport
  useEffect(() => {
    const resize = () => {
      const c = containerRef.current;
      if (!c) return;
      const sz = Math.min(c.clientWidth, c.clientHeight);
      const room = c.querySelector('.so-room') as HTMLElement;
      if (room) { room.style.width = sz + 'px'; room.style.height = sz + 'px'; }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative', width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', background: '#e8e4df',
      }}
    >
      <div className="so-room" style={{ position: 'relative' }}>
        <canvas
          ref={wallRef}
          width={2000} height={2000}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 }}
        />
        <img
          ref={overlayRef}
          alt=""
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            zIndex: 3, pointerEvents: 'none', display: 'none',
          }}
        />
      </div>
    </div>
  );
};
