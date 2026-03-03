/**
 * Generate PWA icon PNGs from the Whisk brand icon.
 * Run: bun scripts/generate-icons.ts
 */
import sharp from "sharp";
import { writeFileSync } from "fs";
import { join } from "path";

const ICON_DIR = join(import.meta.dir, "..", "public", "icons");

function makeIconSvg(size: number, maskable: boolean = false): string {
  const rx = maskable ? 0 : 112;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4ade80"/>
      <stop offset="100%" stop-color="#16a34a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="url(#bg)"/>
  <!-- W letterform -->
  <path d="M 75 155 L 148 380 L 218 235 L 288 380 L 360 155"
        stroke="white" stroke-width="30" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Balloon whisk -->
  <g stroke="white" fill="none" stroke-linecap="round">
    <path d="M410 335 C378 275, 374 210, 410 150" stroke-width="7"/>
    <path d="M410 335 C442 275, 446 210, 410 150" stroke-width="7"/>
    <path d="M410 335 C390 275, 386 210, 410 150" stroke-width="5.5"/>
    <path d="M410 335 C430 275, 434 210, 410 150" stroke-width="5.5"/>
    <line x1="410" y1="335" x2="410" y2="150" stroke-width="4"/>
    <line x1="410" y1="335" x2="410" y2="395" stroke-width="14"/>
  </g>
  <!-- Sparkles -->
  <path d="M440 128 L443 116 L446 128 L458 131 L446 134 L443 146 L440 134 L428 131 Z"
        fill="white" opacity="0.9"/>
  <path d="M373 140 L375 133 L377 140 L384 142 L377 144 L375 151 L373 144 L366 142 Z"
        fill="white" opacity="0.6"/>
  <circle cx="452" cy="178" r="4" fill="white" opacity="0.5"/>
</svg>`;
}

async function generateIcon(name: string, size: number, maskable: boolean = false) {
  const svg = makeIconSvg(size, maskable);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(join(ICON_DIR, name), png);
  console.log(`Generated ${name} (${size}x${size})`);
}

await Promise.all([
  generateIcon("icon-192.png", 192),
  generateIcon("icon-512.png", 512),
  generateIcon("icon-512-maskable.png", 512, true),
  generateIcon("apple-touch-icon.png", 180, true),
]);

console.log("All icons generated.");
