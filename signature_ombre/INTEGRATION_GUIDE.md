# Signature Ombre — React Integration Guide

## 5 Steps to Integrate

### Step 1: Install Three.js
```bash
npm install three @types/three
```

### Step 2: Copy Files into Your Project

```
your-nextjs-app/
├── src/
│   ├── lib/
│   │   └── ombre-engine/
│   │       ├── index.ts
│   │       └── OmbreEmbossEngine.ts
│   │
│   └── components/
│       └── signature-ombre/
│           ├── index.ts
│           ├── SignatureOmbreConfigurator.tsx
│           ├── RoomPreview.tsx
│           ├── LightRing.tsx
│           └── SignatureOmbre.module.css
│
├── public/
│   ├── models/
│   │   └── emboss/
│   │       ├── ribbed-25.obj
│   │       ├── ribbed-45.obj
│   │       ├── ribbed-60.obj
│   │       ├── ribbed-duo.obj
│   │       ├── tapered.obj
│   │       └── flux-ribbed.obj
│   │
│   └── images/
│       └── room-setups/
│           └── Colour_Core_Setup.png
```

### Step 3: Verify Static Assets Are Accessible

Open these URLs in your browser to confirm:
- `http://localhost:3000/models/emboss/ribbed-25.obj`
- `http://localhost:3000/images/room-setups/Colour_Core_Setup.png`

If they don't load, the models/images aren't in the right `public/` folder.

### Step 4: Add to Your Configurator

In your configurator page, conditionally render the component:

```tsx
import { SignatureOmbreConfigurator } from '@/components/signature-ombre';

export default function ConfiguratorPage() {
  const [category, setCategory] = useState('color-core-ombre');

  return (
    <div style={{ height: '100vh' }}>
      {/* Your existing category selector */}

      {category === 'signature-ombre' ? (
        <SignatureOmbreConfigurator />
      ) : (
        <YourExistingConfigurator />
      )}
    </div>
  );
}
```

### Step 5: Done

That's it. The component is self-contained:
- Pre-loads all 6 OBJ models on mount
- Room setup PNG loads automatically
- Color changes update the wall in ~40ms
- Download button exports the full room scene

---

## What Each File Does

| File | Purpose |
|------|---------|
| `OmbreEmbossEngine.ts` | Three.js engine — loads OBJs, generates ombre texture, renders 3D panel, captures front view |
| `SignatureOmbreConfigurator.tsx` | Main component — sidebar with controls + room viewport |
| `RoomPreview.tsx` | Room scene — loads room PNG, tiles 3 panels on wall, overlays furniture |
| `LightRing.tsx` | Circular drag control for rotating HDRI lighting direction |
| `SignatureOmbre.module.css` | All styles (warm theme matching existing configurator) |

## Architecture

```
User picks colors + pattern + rotates light
                |
    [OmbreEmbossEngine.render()]
      1. Canvas 2D ombre gradient     (< 1ms)
      2. Three.js emboss + texture    (~30ms)
      3. Orthographic capture         (~10ms)
                |
      Panel PNG data URL (~40ms total)
                |
    [RoomPreview]
      1. Tiles 3 panels on <canvas>
      2. Room overlay PNG on top
                |
    User sees room with embossed ombre panels
```
