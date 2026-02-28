import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const ICON_DIR = join(import.meta.dir, "..", "public", "icons");

// Ensure directory exists
mkdirSync(ICON_DIR, { recursive: true });

// Orange background with white "W" — matches the favicon.svg design
function createSvg(size: number, padding: number = 0): string {
  const cornerRadius = Math.round(size * 0.2);
  const fontSize = Math.round(size * 0.52);
  const textY = Math.round(size * 0.68);

  if (padding > 0) {
    // Maskable icon: smaller icon with padding for safe zone
    const innerSize = size - padding * 2;
    const innerRadius = Math.round(innerSize * 0.2);
    const innerFontSize = Math.round(innerSize * 0.52);
    const innerTextY = padding + Math.round(innerSize * 0.68);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#f97316"/>
  <rect x="${padding}" y="${padding}" width="${innerSize}" height="${innerSize}" rx="${innerRadius}" fill="#f97316"/>
  <text x="${size / 2}" y="${innerTextY}" font-family="system-ui, -apple-system, sans-serif" font-size="${innerFontSize}" font-weight="bold" text-anchor="middle" fill="white">W</text>
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="#f97316"/>
  <text x="${size / 2}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="white">W</text>
</svg>`;
}

async function generateIcon(name: string, size: number, padding: number = 0) {
  const svg = createSvg(size, padding);
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const outPath = join(ICON_DIR, name);
  writeFileSync(outPath, png);
  console.log(`Generated ${name} (${size}x${size})`);
}

await Promise.all([
  generateIcon("icon-192.png", 192),
  generateIcon("icon-512.png", 512),
  generateIcon("icon-512-maskable.png", 512, 80),
  generateIcon("apple-touch-icon.png", 180),
]);

console.log("All icons generated.");
