/**
 * OmbreEmbossEngine.ts
 *
 * Core rendering engine for Signature Ombre panels.
 * Generates embossed ombré panel images client-side using Three.js.
 *
 * - Pre-loads OBJ models at init (cached in memory)
 * - Generates ombré gradient (base top → overlay darker bottom)
 * - Wraps gradient on 3D emboss model
 * - Captures orthographic front view as PNG data URL
 * - HDRI-style hemisphere + 3-point lighting with rotation
 *
 * Usage:
 *   const engine = new OmbreEmbossEngine();
 *   await engine.preloadAll(patterns);
 *   const { dataUrl } = engine.render({ baseColor, overlayColor, ... });
 *   engine.dispose();
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';

export type OmbreDirection = 'vertical';

export interface PatternConfig {
  id: string;
  name: string;
  modelUrl: string;
  thumbnail?: string;
}

export interface RenderOptions {
  baseColor: string;
  overlayColor: string;
  ombrePercent: number;
  patternId: string;
  lightRotation?: number;    // radians, 0 = front
  renderWidth?: number;      // default 800
}

export interface PanelImage {
  dataUrl: string;
  width: number;
  height: number;
}

interface ModelBounds {
  center: THREE.Vector3;
  size: THREE.Vector3;
  da: string;   // depth axis
  fW: number;   // face width
  fH: number;   // face height
  dv: number;   // depth value
}

export class OmbreEmbossEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private models = new Map<string, THREE.Group>();
  private activeModel: THREE.Group | null = null;
  private activePatternId = '';
  private bounds: ModelBounds | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private texCanvas: HTMLCanvasElement;
  private uvCacheKey = '';
  private lightRotation = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100);

    this.texCanvas = document.createElement('canvas');
    this.texCanvas.width = 512;
    this.texCanvas.height = 1024;

    // Neutral ambient — no sky/ground color tint so overlay hue comes through accurately
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.15);
    this.scene.add(this.hemiLight);

    // 3-point directional lights — pure white to avoid color contamination
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.80);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.25);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    this.rimLight = new THREE.DirectionalLight(0xffe8d0, 0.15);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);
  }

  /** Pre-load all OBJ pattern models in parallel */
  async preloadAll(patterns: PatternConfig[]): Promise<void> {
    const loader = new OBJLoader();
    await Promise.all(
      patterns.map(async (p) => {
        try {
          const res = await fetch(p.modelUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const group = loader.parse(text);
          group.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).geometry.computeVertexNormals();
              (child as THREE.Mesh).material = new THREE.MeshStandardMaterial({
                color: 0xbbbbbb, side: THREE.DoubleSide,
              });
            }
          });
          this.models.set(p.id, group);
        } catch (err) {
          console.error(`Failed to load model ${p.id}:`, err);
        }
      })
    );
  }

  isLoaded(id: string): boolean { return this.models.has(id); }

  /** Render an embossed ombré panel. Returns PNG data URL. ~40-70ms. */
  render(options: RenderOptions): PanelImage {
    const {
      baseColor, overlayColor, ombrePercent, patternId,
      lightRotation = 0, renderWidth = 800,
    } = options;

    this.lightRotation = lightRotation;
    const modelGroup = this.models.get(patternId);
    if (!modelGroup) throw new Error(`Pattern "${patternId}" not loaded.`);

    // 1. Swap model if changed
    if (this.activePatternId !== patternId) {
      if (this.activeModel) this.scene.remove(this.activeModel);
      const obj = modelGroup.clone(true);
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const scale = 2 / Math.max(size.x, size.y, size.z);
      obj.scale.multiplyScalar(scale);
      obj.position.sub(center.multiplyScalar(scale));
      this.activeModel = obj;
      this.activePatternId = patternId;
      this.scene.add(obj);

      // Compute bounds
      const nb = new THREE.Box3().setFromObject(obj);
      const bs = nb.getSize(new THREE.Vector3());
      const dims = [
        { a: 'x', v: bs.x }, { a: 'y', v: bs.y }, { a: 'z', v: bs.z },
      ].sort((a, b) => a.v - b.v);
      this.bounds = {
        center: nb.getCenter(new THREE.Vector3()),
        size: bs, da: dims[0].a,
        fW: Math.max(dims[1].v, dims[2].v),
        fH: Math.min(dims[1].v, dims[2].v),
        dv: dims[0].v,
      };
      this.uvCacheKey = '';
      // Mark UVs as needing regeneration
      obj.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).userData._uvOk = false; });
    }

    // 2. Generate ombré gradient (base top → overlay bottom)
    this.paintOmbre(baseColor, overlayColor, ombrePercent);
    if (!this.texture) {
      this.texture = new THREE.CanvasTexture(this.texCanvas);
      this.texture.encoding = THREE.sRGBEncoding;
      this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    } else {
      this.texture.image = this.texCanvas;
    }
    this.texture.needsUpdate = true;

    // 3. Apply texture + UVs
    this.activeModel!.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      if (!mesh.userData._uvOk) {
        this.generateUVs(mesh.geometry);
        mesh.userData._uvOk = true;
      }
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat?.isMeshStandardMaterial && mat.map === this.texture) {
        mat.needsUpdate = true;
      } else {
        mesh.material = new THREE.MeshStandardMaterial({
          map: this.texture!, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
        });
      }
    });

    // 4. Position lights (HDRI rotation)
    this.positionLights();

    // 5. Setup orthographic camera
    const b = this.bounds!;
    const pad = 1.02;
    this.camera.left = -(b.fW * pad) / 2;
    this.camera.right = (b.fW * pad) / 2;
    this.camera.top = (b.fH * pad) / 2;
    this.camera.bottom = -(b.fH * pad) / 2;
    this.camera.updateProjectionMatrix();
    const ct = b.center;
    if (b.da === 'z') { this.camera.position.set(ct.x, ct.y, ct.z + b.dv + 2); this.camera.up.set(0, 1, 0); }
    else if (b.da === 'x') { this.camera.position.set(ct.x + b.dv + 2, ct.y, ct.z); this.camera.up.set(0, 1, 0); }
    else { this.camera.position.set(ct.x, ct.y + b.dv + 2, ct.z); this.camera.up.set(0, 0, -1); }
    this.camera.lookAt(ct);

    // 6. Render
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);
    const rw = renderWidth;
    const rh = Math.round(renderWidth * b.fH / b.fW);
    this.renderer.setSize(rw, rh);
    this.scene.background = null;
    this.renderer.render(this.scene, this.camera);

    // 7. Auto-crop
    const tmp = document.createElement('canvas');
    tmp.width = rw; tmp.height = rh;
    tmp.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    const cropped = this.autoCrop(tmp);
    return { dataUrl: cropped.toDataURL('image/png'), width: cropped.width, height: cropped.height };
  }

  dispose(): void {
    this.renderer?.dispose(); this.renderer = null;
    this.texture?.dispose(); this.texture = null;
    this.models.forEach((g) => g.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).geometry.dispose();
        const m = (c as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material).dispose();
      }
    }));
    this.models.clear();
    if (this.activeModel) { this.scene.remove(this.activeModel); this.activeModel = null; }
  }

  // ── Private ──

  // Mix overlay color with white: factor=0 → white, factor=1 → full overlay
  private tintColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * factor + 255 * (1 - factor))},${Math.round(g * factor + 255 * (1 - factor))},${Math.round(b * factor + 255 * (1 - factor))})`;
  }

  private paintOmbre(base: string, overlay: string, percent: number) {
    const w = this.texCanvas.width, h = this.texCanvas.height;
    const ctx = this.texCanvas.getContext('2d')!;
    // Top = very pale tint of overlay (not pure white) → smooth, no Mach band at transition
    // midPoint = where full overlay colour is reached; controlled by blend preset
    const topColor = this.tintColor(overlay, 0.10);
    const midPoint = 1 - Math.max(0.05, Math.min(0.95, percent / 100)); // 30%→0.7 | 50%→0.5
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, topColor);
    g.addColorStop(midPoint, overlay);
    g.addColorStop(1, overlay);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Subtle noise
    const img = ctx.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 3; d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  private positionLights() {
    const r = this.lightRotation, d = 5, h = 25 * Math.PI / 180;
    const t = this.bounds ? this.bounds.center : new THREE.Vector3();
    this.keyLight.position.set(t.x + d * Math.cos(h) * Math.sin(r), t.y + d * Math.sin(h), t.z + d * Math.cos(h) * Math.cos(r));
    this.keyLight.target.position.copy(t);
    const fa = r + Math.PI * 0.75;
    this.fillLight.position.set(t.x + d * 0.8 * Math.sin(fa), t.y + d * 0.3, t.z + d * 0.8 * Math.cos(fa));
    this.fillLight.target.position.copy(t);
    this.rimLight.position.set(t.x + d * Math.sin(r + Math.PI), t.y + d * 0.5, t.z + d * Math.cos(r + Math.PI));
    this.rimLight.target.position.copy(t);
  }

  private generateUVs(geometry: THREE.BufferGeometry) {
    const posArr = geometry.attributes.position.array as Float32Array;
    const count = geometry.attributes.position.count;
    const uv = new Float32Array(count * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (this.activeModel) {
      this.activeModel.traverse((c) => {
        if (!(c as THREE.Mesh).isMesh) return;
        const a = (c as THREE.Mesh).geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < a.length; i += 3) {
          if (a[i] < minX) minX = a[i]; if (a[i] > maxX) maxX = a[i];
          if (a[i + 1] < minY) minY = a[i + 1]; if (a[i + 1] > maxY) maxY = a[i + 1];
          if (a[i + 2] < minZ) minZ = a[i + 2]; if (a[i + 2] > maxZ) maxZ = a[i + 2];
        }
      });
    }
    const da = this.bounds?.da || 'z';
    const ix = 1 / (maxX - minX || 1), iy = 1 / (maxY - minY || 1), iz = 1 / (maxZ - minZ || 1);
    for (let i = 0; i < count; i++) {
      const x = posArr[i * 3], y = posArr[i * 3 + 1], z = posArr[i * 3 + 2];
      if (da === 'z') { uv[i * 2] = (x - minX) * ix; uv[i * 2 + 1] = (y - minY) * iy; }
      else if (da === 'x') { uv[i * 2] = (z - minZ) * iz; uv[i * 2 + 1] = (y - minY) * iy; }
      else { uv[i * 2] = (x - minX) * ix; uv[i * 2 + 1] = (z - minZ) * iz; }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }

  private autoCrop(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
    let top = h, left = w, right = 0, bottom = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (y < top) top = y; if (y > bottom) bottom = y;
        if (x < left) left = x; if (x > right) right = x;
      }
    }
    if (right <= left || bottom <= top) return canvas;
    const cw = right - left + 1, ch = bottom - top + 1;
    const out = document.createElement('canvas'); out.width = cw; out.height = ch;
    out.getContext('2d')!.drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
    return out;
  }
}
