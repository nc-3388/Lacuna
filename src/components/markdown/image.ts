// Image handling: downscale and re-encode uploaded/dropped images, then store the Blob
// in IndexedDB's asset table so card rows only carry a small stable reference.

import { compressImageBlob } from '../../utils/compressImage';
import { assetUrl, storeImageBlob } from '../../db/assets';

/**
 * Store an image File as a compressed Blob asset. The image is scaled so its longest
 * edge is at most 1280px and re-encoded as JPEG (or PNG when transparency is likely
 * needed) at ~0.8 quality.
 */
export async function imageFileToAssetUrl(file: File): Promise<string> {
  const { blob, width, height } = await compressImageBlob(file);
  const asset = await storeImageBlob(blob, blob.type || file.type, width, height);
  return assetUrl(asset.hash);
}

/** Build the Markdown for an embedded image. */
export function imageMarkdown(url: string, alt = 'image'): string {
  return `![${alt}](${url})`;
}
