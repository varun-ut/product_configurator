/**
 * SignatureOmbreLightRing.jsx
 *
 * Circular drag control for rotating HDRI lighting around the panel.
 * Drag the handle around the ring to change groove shadow direction.
 */

import React, { useRef, useEffect, useCallback } from 'react';

const SignatureOmbreLightRing = ({ rotation, onChange }) => {
  const canvasRef = useRef(null);
  const handleRef = useRef(null);
  const containerRef = useRef(null);
  const draggingRef = useRef(false);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = 120, cx = 60, cy = 60, R = 46;
    ctx.clearRect(0, 0, w, w);

    // Ring
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#d8d4cf'; ctx.lineWidth = 2; ctx.stroke();

    // Graduation marks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const inn = i % 3 === 0 ? R - 8 : R - 4;
      ctx.beginPath();
      ctx.moveTo(cx + inn * Math.cos(a), cy + inn * Math.sin(a));
      ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      ctx.strokeStyle = i % 3 === 0 ? '#bbb' : '#d0ccc7'; ctx.lineWidth = 1; ctx.stroke();
    }

    // Labels
    ctx.font = '8px "DM Sans", sans-serif'; ctx.fillStyle = '#aaa'; ctx.textAlign = 'center';
    ctx.fillText('F', cx, cy - R - 4); ctx.fillText('B', cx, cy + R + 10);
    ctx.fillText('L', cx - R - 6, cy + 3); ctx.fillText('R', cx + R + 6, cy + 3);

    // Center dot
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = '#ccc'; ctx.fill();

    // Light beam line
    const lx = cx + R * Math.sin(rotation);
    const ly = cy - R * Math.cos(rotation);
    const gr = ctx.createLinearGradient(cx, cy, lx, ly);
    gr.addColorStop(0, 'rgba(196,149,106,0)'); gr.addColorStop(1, 'rgba(196,149,106,.5)');
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(lx, ly);
    ctx.strokeStyle = gr; ctx.lineWidth = 2; ctx.stroke();

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

    const getAngle = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const px = e.touches ? e.touches[0].clientX : e.clientX;
      const py = e.touches ? e.touches[0].clientY : e.clientY;
      return Math.atan2(px - cx, -(py - cy));
    };

    const onMove = (e) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      onChange(getAngle(e));
    };

    const onDown = (e) => {
      draggingRef.current = true;
      onChange(getAngle(e));
    };
    const onUp = () => { draggingRef.current = false; };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    return () => {
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('touchstart', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
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
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#c4956a', lineHeight: 1.2 }}>
          {Math.round(rotation * (180 / Math.PI))}°
        </div>
        <div style={{
          fontSize: 8, color: '#8a8480',
          textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2,
        }}>
          Drag to rotate light
        </div>
      </div>
    </div>
  );
};

export default SignatureOmbreLightRing;
