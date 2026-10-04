/**
 * OmbreEmbossEngine.js
 *
 * Core rendering engine for Signature Ombre panels.
 * Generates embossed ombré panel images client-side using Three.js.
 * Converted from TypeScript to plain JavaScript.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';

export class OmbreEmbossEngine {
  constructor() {
    this.renderer = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100);

    this.texCanvas = document.createElement('canvas');
    this.texCanvas.width = 512;
    this.texCanvas.height = 1024;

    // HDRI-style hemisphere (sky blue top, warm ground bottom)
    this.hemiLight = new THREE.HemisphereLight(0xddeeff, 0x443322, 0.4);
    this.scene.add(this.hemiLight);

    // 3-point directional lights
    this.keyLight = new THREE.DirectionalLight(0xfff5e8, 1.3);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.fillLight = new THREE.DirectionalLight(0xc8d8f0, 0.35);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    this.rimLight = new THREE.DirectionalLight(0xffe8d0, 0.2);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    this.models = new Map();
    this.activeModel = null;
    this.activePatternId = '';
    this.bounds = null;
    this.texture = null;
    this.uvCacheKey = '';
    this.lightRotation = 0;
  }

  /** Pre-load all OBJ pattern models in parallel */
  async preloadAll(patterns) {
    const loader = new OBJLoader();
    await Promise.all(
      patterns.map(async (p) => {
        try {
          const res = await fetch(p.modelUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const group = loader.parse(text);
          group.traverse((child) => {
            if (child.isMesh) {
              child.geometry.computeVertexNormals();
              child.material = new THREE.MeshStandardMaterial({
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

  isLoaded(id) { return this.models.has(id); }

  /** Render an embossed ombré panel. Returns PNG data URL. ~40-70ms. */
  render(options) {
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
      obj.traverse((c) => { if (c.isMesh) c.userData._uvOk = false; });
    }

    // 2. Paint neutral bake texture — ombre is applied as a post-composite so it
    // is always visually dominant and not crushed by 3D lighting/tone-mapping.
    this._paintNeutral();
    if (!this.texture) {
      this.texture = new THREE.CanvasTexture(this.texCanvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    } else {
      this.texture.image = this.texCanvas;
    }
    this.texture.needsUpdate = true;

    // 3. Apply texture + UVs
    this.activeModel.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.userData._uvOk) {
        this._generateUVs(child.geometry);
        child.userData._uvOk = true;
      }
      const mat = child.material;
      if (mat?.isMeshStandardMaterial && mat.map === this.texture) {
        mat.needsUpdate = true;
      } else {
        child.material = new THREE.MeshStandardMaterial({
          map: this.texture, roughness: 0.65, metalness: 0, side: THREE.DoubleSide,
        });
      }
    });

    // 4. Position lights (HDRI rotation)
    this._positionLights();

    // 5. Setup orthographic camera
    const b = this.bounds;
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
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.renderer.toneMappingExposure = 1.1;
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
    tmp.getContext('2d').drawImage(this.renderer.domElement, 0, 0);
    const cropped = this._autoCrop(tmp);

    // 8. Normalize the 3D render so the brightest lit rib face → white.
    //    ACESFilmic tone-mapping leaves lit surfaces at ~85% grey even with a
    //    white albedo.  Without normalization, multiply darkens the whole ombre
    //    by that factor, making it look much duller than the no-emboss version.
    const normCtx = cropped.getContext('2d', { willReadFrequently: true });
    const nImg = normCtx.getImageData(0, 0, cropped.width, cropped.height);
    const npx = nImg.data;
    let maxL = 0;
    for (let i = 0; i < npx.length; i += 4) {
      if (npx[i + 3] > 10) {
        const L = 0.299 * npx[i] + 0.587 * npx[i + 1] + 0.114 * npx[i + 2];
        if (L > maxL) maxL = L;
      }
    }
    if (maxL > 1 && maxL < 252) {
      const scale = 255 / maxL;
      for (let i = 0; i < npx.length; i += 4) {
        if (npx[i + 3] > 10) {
          npx[i]     = Math.min(255, npx[i]     * scale);
          npx[i + 1] = Math.min(255, npx[i + 1] * scale);
          npx[i + 2] = Math.min(255, npx[i + 2] * scale);
        }
      }
      normCtx.putImageData(nImg, 0, 0);
    }

    // 9. Screen-space ombre + depth composite.
    //
    // Strategy: instead of multiply (which darkens the whole panel since average
    // panel luminance is well below white even after normalization), extract the
    // per-pixel DEVIATION of the rib render from its own mean luminance, then
    // add that deviation to the ombre colour.
    //   lit rib tops  (above mean) → slight brightening
    //   shadow grooves (below mean) → darkening
    //   average surface            → zero change
    // The overall panel luminance is therefore preserved exactly.
    const ribPixels = normCtx.getImageData(0, 0, cropped.width, cropped.height);
    const rd = ribPixels.data;

    // Compute mean luminance of all opaque rib pixels
    let totalL = 0, pixCount = 0;
    for (let i = 0; i < rd.length; i += 4) {
      if (rd[i + 3] > 10) {
        totalL += 0.299 * rd[i] + 0.587 * rd[i + 1] + 0.114 * rd[i + 2];
        pixCount++;
      }
    }
    const meanL = pixCount > 0 ? totalL / pixCount : 200;

    // Build ombre gradient via the shared smoothstep-based builder so the flat
    // and embossed paths stay in sync AND neither shows the Mach band that a
    // naive 3-stop linear gradient produces at the gradient→solid junction.
    // baseColor is kept in the options for API compatibility but the pale top
    // is now derived from overlayColor inside buildOmbreGradient.
    const ombreCv = document.createElement('canvas');
    ombreCv.width = cropped.width; ombreCv.height = cropped.height;
    const octx = ombreCv.getContext('2d');
    octx.fillStyle = OmbreEmbossEngine.buildOmbreGradient(octx, ombreCv.width, ombreCv.height, overlayColor, ombrePercent);
    octx.fillRect(0, 0, ombreCv.width, ombreCv.height);
    const ombreImg = octx.getImageData(0, 0, ombreCv.width, ombreCv.height);
    const od = ombreImg.data;

    // Add rib deviation to ombre, preserving the alpha silhouette from 3D render
    const STRENGTH = 0.55; // how strongly rib depth modulates the colour
    for (let i = 0; i < od.length; i += 4) {
      if (rd[i + 3] > 10) {
        const ribL = 0.299 * rd[i] + 0.587 * rd[i + 1] + 0.114 * rd[i + 2];
        const dev = ((ribL - meanL) / 255) * STRENGTH * 255;
        od[i]     = Math.max(0, Math.min(255, od[i]     + dev));
        od[i + 1] = Math.max(0, Math.min(255, od[i + 1] + dev));
        od[i + 2] = Math.max(0, Math.min(255, od[i + 2] + dev));
        od[i + 3] = rd[i + 3]; // silhouette from 3D render
      } else {
        od[i + 3] = 0;
      }
    }

    const comp = document.createElement('canvas');
    comp.width = cropped.width; comp.height = cropped.height;
    comp.getContext('2d').putImageData(ombreImg, 0, 0);

    return { dataUrl: comp.toDataURL('image/png'), width: comp.width, height: comp.height };
  }

  // Blend `hex` toward white by `1 - strength` (strength=0.22 → 22% hex, 78% white).
  // Shared with the flat-panel rendering path in Configurator.jsx so both
  // surfaces produce the same pale top tint for a given overlay color.
  //
  // Why 0.22: a 10% strength produced a near-pure-white top, which made the
  // gradient read as washed-out compared to the prerendered Color Core Ombre
  // reference. 0.22 keeps the top clearly pale while preserving enough of the
  // overlay hue to read as the same colour family as the bottom.
  static tintColor(hex, strength = 0.22) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const w = 1 - strength;
    return `rgb(${Math.round(r * strength + 255 * w)},${Math.round(g * strength + 255 * w)},${Math.round(b * strength + 255 * w)})`;
  }

  // Build the vertical ombre gradient used by both flat and embossed panels.
  //
  // Shape target: match the prerendered Color Core Ombre panels — warm pale
  // tint for the first ~15% from the top, steepest transition through the
  // middle, then eases into a deeply saturated overlay at the bottom.
  //
  // Construction:
  //   1. Biased coordinate  t = y ^ exp   where exp = ln(0.5) / ln(1 - pct),
  //      which shifts the curve so blend = 0.5 at y = 1 - pct.  `blendPct`
  //      keeps its "overlay coverage" feel: higher → midpoint moves upward,
  //      lower → midpoint moves downward.
  //   2. Smootherstep       blend = 6t⁵ - 15t⁴ + 10t³
  //      Flatter near t=0 and t=1 than cubic smoothstep and steeper through
  //      the middle — produces the "long pale top, fast middle, long
  //      saturated bottom" reading the Color Core reference shows.  C²
  //      continuous at both endpoints (first AND second derivatives are
  //      zero) so there is no kink for Mach banding to form against.
  //
  // Top tint strength 0.22 keeps the top clearly pale while retaining enough
  // overlay hue so the panel reads as one colour family, not overlay dropped
  // onto white.
  //
  // 32 intermediate stops keep the curve visually smooth without needing
  // pixel-by-pixel painting.
  static buildOmbreGradient(ctx, width, height, overlayHex, blendPct) {
    // Intensity bias: the raw slider reads as "lighter than the setting
    // implies" — smootherstep's flat tails make the pale zone long and the
    // saturated zone short, so soBlend=50 visually lands near 30% overlay
    // coverage.  Adding a constant 0.15 to the internal pct shifts the
    // perceptual midpoint upward on the panel so 50 reads as ~50/50.  Applied
    // to every setting, so 30 and 40 benefit identically.  Tune BIAS down
    // toward 0 to weaken the correction, up toward 0.25 to strengthen it.
    const BIAS = 0.15;
    const pct = Math.max(0.05, Math.min(0.95, blendPct / 100 + BIAS));
    const topColor = OmbreEmbossEngine.tintColor(overlayHex); // uses default strength 0.22
    const grad = ctx.createLinearGradient(0, 0, 0, height);

    // Parse colors once for interpolation
    const parse = (c) => {
      if (c.startsWith('rgb')) {
        const m = c.match(/\d+/g);
        return [+m[0], +m[1], +m[2]];
      }
      const h = c.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const [tr, tg, tb] = parse(topColor);
    const [or, og, ob] = parse(overlayHex);
    const mix = (s) => `rgb(${Math.round(tr + (or - tr) * s)},${Math.round(tg + (og - tg) * s)},${Math.round(tb + (ob - tb) * s)})`;

    const mid = Math.max(0.05, Math.min(0.95, 1 - pct));
    const exponent = Math.log(0.5) / Math.log(mid);

    const STEPS = 32;
    for (let i = 0; i <= STEPS; i++) {
      const y = i / STEPS;
      const t = Math.pow(y, exponent);
      // Perlin quintic smootherstep: 6t⁵ - 15t⁴ + 10t³.
      // Flatter near t=0 and t=1 than cubic smoothstep and steeper through the
      // middle — matches the Color Core reference's "long pale top, fast
      // middle, long saturated bottom" profile, and still has C² continuity
      // at both endpoints (first and second derivatives are zero) so there is
      // no kink for Mach banding.
      const blend = t * t * t * (t * (t * 6 - 15) + 10);
      grad.addColorStop(y, mix(blend));
    }
    return grad;
  }

  dispose() {
    this.renderer?.dispose(); this.renderer = null;
    this.texture?.dispose(); this.texture = null;
    this.models.forEach((g) => g.traverse((c) => {
      if (c.isMesh) {
        c.geometry.dispose();
        const m = c.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    }));
    this.models.clear();
    if (this.activeModel) { this.scene.remove(this.activeModel); this.activeModel = null; }
  }

  // ── Private ──

  // Paints the geometry texture with a neutral light grey.
  // The actual ombre gradient is applied in screen space after rendering
  // so it is never washed out by the 3D lighting pipeline.
  _paintNeutral() {
    const w = this.texCanvas.width, h = this.texCanvas.height;
    const ctx = this.texCanvas.getContext('2d');
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, w, h);
  }

  _paintOmbre(base, overlay, percent) {
    const w = this.texCanvas.width, h = this.texCanvas.height;
    const ctx = this.texCanvas.getContext('2d');

    // percent = how far up from the bottom the overlay (dark) colour reaches.
    // e.g. 30 → top 70% stays solid base, bottom 30% fades to overlay.
    const pct = Math.min(0.95, Math.max(0.05, percent / 100));
    const transStart = 1 - pct; // canvas-Y (0=top) where the fade begins

    // Parse hex colours inline
    const ph = (hex) => {
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const [br, bg, bb] = ph(base);
    const [or, og, ob] = ph(overlay);

    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;

    for (let y = 0; y < h; y++) {
      const yNorm = y / (h - 1); // 0 = top of canvas = top of panel
      let blend;
      if (yNorm <= transStart) {
        blend = 0; // solid base zone
      } else {
        const t = (yNorm - transStart) / pct;
        blend = t * t * t; // cubic ease-in: dark hit concentrates at the very bottom
      }
      const pr = br + (or - br) * blend;
      const pg = bg + (og - bg) * blend;
      const pb = bb + (ob - bb) * blend;
      for (let x = 0; x < w; x++) {
        const n = (Math.random() - 0.5) * 12;
        const idx = (y * w + x) * 4;
        d[idx]     = Math.max(0, Math.min(255, pr + n));
        d[idx + 1] = Math.max(0, Math.min(255, pg + n));
        d[idx + 2] = Math.max(0, Math.min(255, pb + n));
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  _positionLights() {
    const r = this.lightRotation, d = 5, h = 25 * Math.PI / 180;
    const t = this.bounds ? this.bounds.center : new THREE.Vector3();
    const da = this.bounds?.da || 'z';
    const fa = r + Math.PI * 0.75;

    // Lights must be positioned relative to the camera's viewing axis (da),
    // otherwise models whose depth axis is not Z receive side-lit or back-lit
    // rendering despite the same lightRotation value.
    if (da === 'x') {
      // Camera at +X looking –X; front = +X, orbit around Y
      this.keyLight.position.set(t.x + d * Math.cos(h) * Math.cos(r), t.y + d * Math.sin(h), t.z + d * Math.cos(h) * Math.sin(r));
      this.fillLight.position.set(t.x + d * 0.8 * Math.cos(fa), t.y + d * 0.3, t.z + d * 0.8 * Math.sin(fa));
      this.rimLight.position.set(t.x + d * Math.cos(r + Math.PI), t.y + d * 0.5, t.z + d * Math.sin(r + Math.PI));
    } else if (da === 'y') {
      // Camera at +Y looking –Y; front = +Y, orbit in XZ plane
      this.keyLight.position.set(t.x + d * Math.cos(h) * Math.sin(r), t.y + d * Math.cos(h) * Math.cos(r), t.z + d * Math.sin(h));
      this.fillLight.position.set(t.x + d * 0.8 * Math.sin(fa), t.y + d * 0.8 * Math.cos(fa), t.z + d * 0.3);
      this.rimLight.position.set(t.x + d * Math.sin(r + Math.PI), t.y + d * Math.cos(r + Math.PI), t.z + d * 0.5);
    } else {
      // da === 'z': Camera at +Z looking –Z; front = +Z, orbit around Y (original behaviour)
      this.keyLight.position.set(t.x + d * Math.cos(h) * Math.sin(r), t.y + d * Math.sin(h), t.z + d * Math.cos(h) * Math.cos(r));
      this.fillLight.position.set(t.x + d * 0.8 * Math.sin(fa), t.y + d * 0.3, t.z + d * 0.8 * Math.cos(fa));
      this.rimLight.position.set(t.x + d * Math.sin(r + Math.PI), t.y + d * 0.5, t.z + d * Math.cos(r + Math.PI));
    }

    this.keyLight.target.position.copy(t);
    this.fillLight.target.position.copy(t);
    this.rimLight.target.position.copy(t);
  }

  _generateUVs(geometry) {
    const posArr = geometry.attributes.position.array;
    const count = geometry.attributes.position.count;
    const uv = new Float32Array(count * 2);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (this.activeModel) {
      this.activeModel.traverse((c) => {
        if (!c.isMesh) return;
        const a = c.geometry.attributes.position.array;
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

  _autoCrop(canvas) {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
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
    out.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
    return out;
  }
}
