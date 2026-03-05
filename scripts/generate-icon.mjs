#!/usr/bin/env node

/**
 * Generate the BluSlate app icon.
 *
 * Renders an SVG (dark background, centered disc rings, large white-to-blue
 * gradient "B") into a 1024x1024 PNG at packages/gui/resources/icon.png.
 *
 * electron-builder automatically converts this PNG into:
 *   - .icns for macOS
 *   - .ico  for Windows
 *   - uses the PNG directly for Linux
 *
 * Usage:
 *   node scripts/generate-icon.mjs
 *
 * Requires `sharp` (installed as a root devDependency).
 */

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'packages', 'gui', 'resources');
const OUTPUT_PATH = join(OUTPUT_DIR, 'icon.png');

const SIZE = 1024;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#60a5fa"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#bg)"/>
  <!-- Glow -->
  <circle cx="512" cy="512" r="450" fill="url(#glow)"/>
  <!-- Disc — true center, large, subtle fill to distinguish from bg -->
  <circle cx="512" cy="512" r="430" fill="#0a1a30" stroke="url(#blue)" stroke-width="4" opacity="0.6"/>
  <circle cx="512" cy="512" r="390" fill="none" stroke="#3b82f6" stroke-width="1" opacity="0.12"/>
  <circle cx="512" cy="512" r="350" fill="none" stroke="#3b82f6" stroke-width="1" opacity="0.15"/>
  <circle cx="512" cy="512" r="310" fill="none" stroke="#60a5fa" stroke-width="1" opacity="0.18"/>
  <circle cx="512" cy="512" r="270" fill="none" stroke="#60a5fa" stroke-width="1" opacity="0.22"/>
  <circle cx="512" cy="512" r="230" fill="none" stroke="#93c5fd" stroke-width="1" opacity="0.25"/>
  <circle cx="512" cy="512" r="190" fill="none" stroke="#93c5fd" stroke-width="1.2" opacity="0.28"/>
  <circle cx="512" cy="512" r="150" fill="none" stroke="#93c5fd" stroke-width="1.2" opacity="0.3"/>
  <circle cx="512" cy="512" r="110" fill="none" stroke="#bfdbfe" stroke-width="1" opacity="0.3"/>
  <!-- Center hole -->
  <circle cx="512" cy="512" r="40" fill="#020617" stroke="#3b82f6" stroke-width="2.5" opacity="0.7"/>
  <!-- Large B — white-to-blue gradient, bottom-right -->
  <text x="688" y="947"
        text-anchor="middle"
        font-family="'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="875"
        font-weight="800"
        fill="url(#bGrad)">B</text>
</svg>`;

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png()
    .toFile(OUTPUT_PATH);

  console.log(`Icon generated: ${OUTPUT_PATH} (${SIZE}x${SIZE})`);
}

main().catch((err) => {
  console.error('Failed to generate icon:', err);
  process.exit(1);
});
