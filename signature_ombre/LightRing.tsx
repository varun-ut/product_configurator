/**
 * LightRing.tsx
 *
 * Circular drag control for rotating HDRI lighting around the panel.
 * Drag the handle around the ring to change groove shadow direction.
 */

'use client';

import React, { useRef, useEffect, useCallback } from 'react';

interface LightRingProps {
  rotation: number;
  onChange: (rotation: number) => void;
}

export const LightRing: React.FC<LightRingProps> = ({ rotation, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const x = cv.getContext('2d')!;
    const w = 120, cx = 60, cy = 60, R = 46;
    x.clearRect(0, 0, w, w);

    // Ring
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2);
    x.strokeStyle = '#d8d4cf'; x.lineWidth = 2; x.stroke();

    // Graduation marks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const inn = i % 3 === 0 ? R - 8 : R - 4;
      x.beginPath();
      x.moveTo(cx + inn * Math.cos(a), cy + inn * Math.sin(a));
      x.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      x.strokeStyle = i % 3 === 0 ? '#bbb' : '#d0ccc7'; x.lineWidth = 1; x.stroke();
    }

    // Labels
    x.font = '8px "DM Sans", sans-serif'; x.fillStyle = '#aaa'; x.textAlign = 'center';
    x.fillText('F', cx, cy - R - 4); x.fillText('B', cx, cy + R + 10);
    x.fillText('L', cx - R - 6, cy + 3); x.fillText('R', cx + R + 6, cy + 3);

    // Center dot
    x.beginPath(); x.arc(cx, cy, 3, 0, Math.PI * 2); x.fillStyle = '#ccc'; x.fill();

    // Light beam line
    const lx = cx + R * Math.sin(rotation);
    const ly = cy - R * Math.cos(rotation);
    const gr = x.createLinearGradient(cx, cy, lx, ly);
    gr.addColorStop(0, 'rgba(196,149,106,0)'); gr.addColorStop(1, 'rgba(196,149,106,.5)');
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(lx, ly);
    x.strokeStyle = gr; x.lineWidth = 2; x.stroke();

    // Position handle
    if (handleRef.current) {
      handleRef.current.style.left = lx + 'px';
      handleRef.current.style.top = ly + 'px';
    }
  }, [rotation]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getAngle = (e: MouseEvent | TouchEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const px = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const py = 'touches' in e ? e.touches[0].clientY : e.clientY;
      return Math.atan2(px - cx, -(py - cy));
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      onChange(getAngle(e));
    };

    const onDown = (e: MouseEvent | TouchEvent) => {
      draggingRef.current = true;
      onChange(getAngle(e));
    };
    const onUp = () => { draggingRef.current = false; };

    el.addEventListener('mousedown', onDown as EventListener);
    el.addEventListener('touchstart', onDown as EventListener, { passive: false });
    window.addEventListener('mousemove', onMove as EventListener);
    window.addEventListener('touchmove', onMove as EventListener, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    return () => {
      el.removeEventListener('mousedown', onDown as EventListener);
      el.removeEventListener('touchstart', onDown as EventListener);
      window.removeEventListener('mousemove', onMove as EventListener);
      window.removeEventListener('touchmove', onMove as EventListener);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [onChange]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
        <div ref={containerRef} style={{ position: 'relative', width: 120, height: 120, cursor: 'grab' }}>
          <canvas ref={canvasRef} width={120} height={120} style={{ width: 120, height: 120 }} />
          <div
            ref={handleRef}
            style={{
              position: 'absolute', width: 14, height: 14, background: '#c4956a',
              border: '2px solid #fff', borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 6px rgba(196,149,106,.3)', pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      <div style={{
        textAlign: 'center', fontSize: 8, color: '#8a8480',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>
        Drag to rotate light
      </div>
    </div>
  );
};
