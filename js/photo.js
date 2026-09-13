import { PHOTO_MAX_BYTES, PHOTO_MAX_PX } from "./config.js";

async function loadImage(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not read that image."));
        image.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function compressPhoto(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please choose an image.");
  }
  const bitmap = await loadImage(file);
  const scale = Math.min(1, PHOTO_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = 0.72;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  while (blob && blob.size > PHOTO_MAX_BYTES && quality > 0.4) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }
  if (!blob || blob.size > PHOTO_MAX_BYTES) {
    throw new Error("That photo is still too large after compression. Try a simpler image.");
  }
  return blobToDataUrl(blob);
}
