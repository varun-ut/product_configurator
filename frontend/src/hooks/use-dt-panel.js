// Legacy shim — wraps useBlobPanel so existing imports keep working.
import { useBlobPanel } from "./use-blob-panel";

// const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8001";
const ASSETS_URL = process.env.REACT_APP_ASSETS_URL || "http://localhost:8001";

/**
 * @param {string|null} fabricId  - e.g. "FB1"
 * @param {string|null} shadeId   - e.g. "Blue_1"
 * @returns {{ blobUrl: string|null, isLoading: boolean }}
 */
export function useDTPanel(fabricId, shadeId) {
  const url =
    fabricId && shadeId
      ? `${ASSETS_URL}/static/images/fabric/designer_textile/panels/${fabricId}_${shadeId}.jpg`
      : null;
  return useBlobPanel(url);
}

