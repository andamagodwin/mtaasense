// Client-side photo checks. The server re-validates everything; this just gives fast feedback.

export const MAX_UPLOAD_EDGE = 2560;
const DOWNSCALE_OVER_BYTES = 4 * 1024 * 1024;

export async function sniffImage(file: File): Promise<"jpeg" | "png" | "webp" | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "webp";
  return null;
}

/**
 * Large phone photos are re-encoded to ≤2560px JPEG before upload to keep uploads fast on mobile
 * networks (this also drops EXIF, including any embedded GPS). Smaller files are sent untouched.
 */
export async function prepareForUpload(file: File): Promise<{ blob: Blob; resized: boolean; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = bitmap;
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_UPLOAD_EDGE && file.size <= DOWNSCALE_OVER_BYTES) {
    bitmap.close();
    return { blob: file, resized: false, width, height };
  }
  const scale = Math.min(1, MAX_UPLOAD_EDGE / longEdge);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { blob: file, resized: false, width, height };
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  return blob ? { blob, resized: true, width: w, height: h } : { blob: file, resized: false, width, height };
}
