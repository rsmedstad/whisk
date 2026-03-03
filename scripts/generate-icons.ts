/**
 * Generate PWA icon PNGs with whisk graphic.
 * Run: bun scripts/generate-icons.ts
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const ICON_DIR = join(import.meta.dir, "..", "public", "icons");
mkdirSync(ICON_DIR, { recursive: true });

const ICON_COLOR = "#4ade80"; // green-400
const BG_DARK = "#1c1917"; // stone-950

function makeWhiskSvg(size: number, maskable: boolean = false): string {
  const cornerRadius = maskable ? 0 : Math.round(size * 0.21);
  const padding = maskable ? size * 0.2 : size * 0.1;
  const cx = size / 2;
  const avail = size - padding * 2;
  const whiskTop = padding + avail * 0.08;
  const junction = padding + avail * 0.64;
  const handleEnd = padding + avail * 0.88;
  const spread = avail * 0.24;
  const inner = avail * 0.15;
  const sw = (f: number) => (avail * f).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${BG_DARK}"/>
  <g stroke="${ICON_COLOR}" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${cx} ${junction} C${cx - spread} ${junction - avail * 0.15}, ${cx - spread - 4} ${whiskTop + avail * 0.15}, ${cx} ${whiskTop}" stroke-width="${sw(0.035)}"/>
    <path d="M${cx} ${junction} C${cx + spread} ${junction - avail * 0.15}, ${cx + spread + 4} ${whiskTop + avail * 0.15}, ${cx} ${whiskTop}" stroke-width="${sw(0.035)}"/>
    <path d="M${cx} ${junction} C${cx - inner} ${junction - avail * 0.12}, ${cx - inner - 2} ${whiskTop + avail * 0.12}, ${cx} ${whiskTop}" stroke-width="${sw(0.03)}"/>
    <path d="M${cx} ${junction} C${cx + inner} ${junction - avail * 0.12}, ${cx + inner + 2} ${whiskTop + avail * 0.12}, ${cx} ${whiskTop}" stroke-width="${sw(0.03)}"/>
    <line x1="${cx}" y1="${junction}" x2="${cx}" y2="${whiskTop}" stroke-width="${sw(0.028)}"/>
    <line x1="${cx}" y1="${junction}" x2="${cx}" y2="${handleEnd}" stroke-width="${sw(0.055)}"/>
  </g>
</svg>`;
}

async function generateIcon(name: string, size: number, maskable: boolean = false) {
  const svg = makeWhiskSvg(size, maskable);
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  writeFileSync(join(ICON_DIR, name), png);
  console.log(`Generated ${name} (${size}x${size})`);
}

await Promise.all([
  generateIcon("icon-192.png", 192),
  generateIcon("icon-512.png", 512),
  generateIcon("icon-512-maskable.png", 512, true),
  generateIcon("apple-touch-icon.png", 180),
]);

console.log("All icons generated.");
