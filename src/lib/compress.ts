interface CompressOptions {
  maxWidth: number;
  quality: number;
  format?: "webp" | "jpeg";
}

const PRESETS = {
  hero: { maxWidth: 1200, quality: 0.8 } as CompressOptions,
  thumbnail: { maxWidth: 300, quality: 0.7 } as CompressOptions,
  step: { maxWidth: 800, quality: 0.75 } as CompressOptions,
};

export type CompressPreset = keyof typeof PRESETS;

export async function compressImage(
  file: File,
  preset: CompressPreset
): Promise<Blob> {
  const options = PRESETS[preset];
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, options.maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const format = options.format ?? "webp";
  const blob = await canvas.convertToBlob({
    type: `image/${format}`,
    quality: options.quality,
  });

  return blob;
}

export async function compressForUpload(
  file: File
): Promise<{ hero: Blob; thumbnail: Blob }> {
  const [hero, thumbnail] = await Promise.all([
    compressImage(file, "hero"),
    compressImage(file, "thumbnail"),
  ]);
  return { hero, thumbnail };
}
