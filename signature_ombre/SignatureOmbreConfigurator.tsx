/**
 * SignatureOmbreConfigurator.tsx
 *
 * Self-contained Signature Ombre configurator.
 * Render this component when category === 'signature-ombre'.
 *
 * Features:
 * - Dual color pickers (base top, overlay darker bottom)
 * - Ombre blend slider
 * - 6 emboss pattern cards (pre-loaded OBJ files)
 * - HDRI light rotation ring
 * - Room preview with 3 tiled panels
 * - Download button
 *
 * Usage:
 *   import { SignatureOmbreConfigurator } from '@/components/signature-ombre';
 *   <SignatureOmbreConfigurator />
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OmbreEmbossEngine } from '../../lib/ombre-engine';
import type { PatternConfig } from '../../lib/ombre-engine';
import { RoomPreview } from './RoomPreview';
import { LightRing } from './LightRing';
import styles from './SignatureOmbre.module.css';

// ═══════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════
const PATTERNS: PatternConfig[] = [
  { id: 'ribbed-25',   name: 'Ribbed 25',   modelUrl: '/models/emboss/ribbed-25.obj' },
  { id: 'ribbed-45',   name: 'Ribbed 45',   modelUrl: '/models/emboss/ribbed-45.obj' },
  { id: 'ribbed-60',   name: 'Ribbed 60',   modelUrl: '/models/emboss/ribbed-60.obj' },
  { id: 'ribbed-duo',  name: 'Ribbed Duo',  modelUrl: '/models/emboss/ribbed-duo.obj' },
  { id: 'tapered',     name: 'Tapered',     modelUrl: '/models/emboss/tapered.obj' },
  { id: 'flux-ribbed', name: 'Flux Ribbed', modelUrl: '/models/emboss/flux-ribbed.obj' },
];

const PAT_ICONS: Record<string, string> = {
  'ribbed-25':   'M4,2v20M8,2v20M12,2v20M16,2v20M20,2v20',
  'ribbed-45':   'M3,2v20M7,2v20M11,2v20M15,2v20M19,2v20M21,2v20',
  'ribbed-60':   'M2,2v20M6,2v20M10,2v20M18,2v20M22,2v20',
  'ribbed-duo':  'M3,2v20M5,2v20M10,2v20M12,2v20M17,2v20M19,2v20',
  'tapered':     'M4,2v20M8,4v16M12,6v12M16,4v16M20,2v20',
  'flux-ribbed': 'M3,2v20M6,2v20M10,2v20M14,2v20M17,2v20M21,2v20',
};
// ═══════════════════════════════════════

export const SignatureOmbreConfigurator: React.FC = () => {
  const [baseColor, setBaseColor] = useState('#C47A4A');
  const [overlayColor, setOverlayColor] = useState('#6B3A2A');
  const [blend, setBlend] = useState(50);
  const [selectedPattern, setSelectedPattern] = useState(PATTERNS[0].id);
  const [lightRotation, setLightRotation] = useState(0);
  const [panelImage, setPanelImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const engineRef = useRef<OmbreEmbossEngine | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Init engine + preload all models
  useEffect(() => {
    const engine = new OmbreEmbossEngine();
    engineRef.current = engine;
    setIsLoading(true);
    engine.preloadAll(PATTERNS).then(() => {
      setIsLoading(false);
    });
    return () => { engine.dispose(); };
  }, []);

  // Render panel whenever any input changes
  const renderPanel = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || isLoading || !engine.isLoaded(selectedPattern)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const result = engine.render({
          baseColor, overlayColor, ombrePercent: blend,
          patternId: selectedPattern, lightRotation,
        });
        setPanelImage(result.dataUrl);
      } catch (err) {
        console.error('Render failed:', err);
      }
    }, 40);
  }, [baseColor, overlayColor, blend, selectedPattern, lightRotation, isLoading]);

  useEffect(() => { renderPanel(); }, [renderPanel]);

  // Download composited room scene
  const handleDownload = () => {
    const wallCanvas = document.querySelector('.so-room canvas') as HTMLCanvasElement;
    const overlayImg = document.querySelector('.so-room img') as HTMLImageElement;
    if (!wallCanvas) return;
    const out = document.createElement('canvas'); out.width = 2000; out.height = 2000;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(wallCanvas, 0, 0, 2000, 2000);
    if (overlayImg?.complete && overlayImg.naturalWidth) ctx.drawImage(overlayImg, 0, 0, 2000, 2000);
    const url = out.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url;
    a.download = `SignatureOmbre_${selectedPattern}_${baseColor.replace('#', '')}_${overlayColor.replace('#', '')}.png`;
    a.click();
  };

  const ombreGradient = `linear-gradient(to bottom, ${baseColor} 0%, ${baseColor} ${blend}%, ${overlayColor} 100%)`;

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ── */}
      <aside className={styles.sidebar}>
        {/* Product */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Product</h3>
          <div className={styles.productName}>Signature Ombre</div>
          <div className={styles.productMeta}>1200 × 2800 mm · 3-Panel Wall Setup</div>
        </div>

        {/* Ombre Colors */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Ombre Colors</h3>
          <div className={styles.colorDuo}>
            <div className={styles.colorBox}>
              <label className={styles.colorLabel}>Base Color (Top)</label>
              <div className={styles.colorSwatch} style={{ background: baseColor }}>
                <input type="color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} className={styles.colorInput} />
              </div>
              <div className={styles.colorHex}>{baseColor.toUpperCase()}</div>
            </div>
            <div className={styles.colorBox}>
              <label className={styles.colorLabel}>Overlay Color (Bottom)</label>
              <div className={styles.colorSwatch} style={{ background: overlayColor }}>
                <input type="color" value={overlayColor} onChange={(e) => setOverlayColor(e.target.value)} className={styles.colorInput} />
              </div>
              <div className={styles.colorHex}>{overlayColor.toUpperCase()}</div>
            </div>
          </div>
          <div className={styles.ombreBar} style={{ background: ombreGradient }} />
          <div className={styles.sliderRow}>
            <label>Ombre Blend</label>
            <span className={styles.sliderValue}>{blend}%</span>
          </div>
          <input type="range" min={10} max={90} step={1} value={blend}
            onChange={(e) => setBlend(parseInt(e.target.value))} className={styles.slider} />
        </div>

        {/* Emboss Patterns */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Emboss Pattern</h3>
          <div className={styles.patternGrid}>
            {PATTERNS.map((p) => (
              <button
                key={p.id} type="button"
                className={`${styles.patternCard} ${selectedPattern === p.id ? styles.patternCardSel : ''}`}
                onClick={() => setSelectedPattern(p.id)}
              >
                {selectedPattern === p.id && (
                  <div className={styles.patternCheck}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" width="8" height="8">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
                <div className={styles.patternIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="26" height="26">
                    <path d={PAT_ICONS[p.id] || PAT_ICONS['ribbed-25']} />
                  </svg>
                </div>
                <div className={styles.patternName}>{p.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* HDRI Light Ring */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>HDRI Lighting</h3>
          <LightRing rotation={lightRotation} onChange={setLightRotation} />
        </div>
      </aside>

      {/* ── Room Viewport ── */}
      <div className={styles.viewport}>
        <RoomPreview panelImage={panelImage} panelCount={3} />

        {/* Download */}
        <button className={styles.downloadBtn} onClick={handleDownload} disabled={!panelImage}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>

        {/* Loading overlay */}
        {isLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <div className={styles.loadingText}>Loading emboss patterns…</div>
          </div>
        )}
      </div>
    </div>
  );
};
