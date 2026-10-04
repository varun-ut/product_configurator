/**
 * A small curated set of UniVicoustic panel cutouts to use in the
 * standalone visualizer.  Hard-coded on purpose so this module stays fully
 * isolated from the main configurator's data layer (`src/data/skus.js`,
 * the products.json fetch, etc.) — the whole visualizer feature can be
 * removed by deleting `src/visualizer/` plus the one `<Route>` line in
 * App.js, no other files touched.
 *
 * URLs point at the same CDN cutouts the main configurator's "Download
 * Panel" hover card already serves up, so Wizart can fetch them without
 * us hosting anything extra.
 *
 * To swap or extend the list, drop more entries here.  Each entry needs:
 *   id, name, family (just for grouping in the UI), thumbnailUrl.
 */

const ASSETS = process.env.REACT_APP_ASSETS_URL || "";

export const SAMPLE_PANELS = [
  // VicStrip — vertical slat panels (the cutouts we generated this session)
  {
    id: "vicstrip-single-groove-alpine-frost",
    name: "Single Groove · Alpine Frost",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/single-groove/alpine-frost.jpg`,
  },
  {
    id: "vicstrip-single-groove-merlot",
    name: "Single Groove · Merlot",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/single-groove/merlot.jpg`,
  },
  {
    id: "vicstrip-double-groove-bourbon-walnut",
    name: "Double Groove · Bourbon Walnut",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/double-groove/bourbon-walnut.jpg`,
  },
  {
    id: "vicstrip-double-groove-sage-green",
    name: "Double Groove · Sage Green",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/double-groove/sage-green.jpg`,
  },
  {
    id: "vicstrip-square-glacier-white",
    name: "Square · Glacier White",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/square/glacier-white.jpg`,
  },
  {
    id: "vicstrip-square-monarch-oak",
    name: "Square · Monarch Oak",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/square/monarch-oak.jpg`,
  },
  {
    id: "vicstrip-double-square-carbon-black",
    name: "Double Square · Carbon Black",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/double-square/carbon-black.jpg`,
  },
  {
    id: "vicstrip-double-square-toffee-oak",
    name: "Double Square · Toffee Oak",
    family: "VicStrip",
    thumbnailUrl: `${ASSETS}/static/images/vicstrip/panels/double-square/toffee-oak.jpg`,
  },
];
