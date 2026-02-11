#!/usr/bin/env node

/**
 * Generate the MediaFetch placeholder app icon.
 *
 * Renders an SVG (dark gradient rounded-rect + bold white "M") into a
 * 1024x1024 PNG at packages/gui/resources/icon.png.
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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'packages', 'gui', 'resources');
const OUTPUT_PATH = join(OUTPUT_DIR, 'icon.png');

const SIZE = 1024;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1a1a2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <!-- Background rounded-rect -->
  <rect width="${SIZE}" height="${SIZE}" rx="200" ry="200" fill="url(#bg)"/>
  <!-- Subtle inner border -->
  <rect x="20" y="20" width="${SIZE - 40}" height="${SIZE - 40}" rx="185" ry="185"
        fill="none" stroke="url(#accent)" stroke-width="4" opacity="0.3"/>
  <!-- Film-reel accent strip at top -->
  <rect x="180" y="140" width="664" height="8" rx="4" fill="url(#accent)" opacity="0.5"/>
  <!-- Bold "M" letter -->
  <text x="512" y="700"
        text-anchor="middle"
        font-family="'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="560"
        font-weight="800"
        fill="#f1f5f9"
        letter-spacing="-20">M</text>
  <!-- Subtle "f" subscript for "MediaFetch" -->
  <text x="740" y="780"
        text-anchor="middle"
        font-family="'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="180"
        font-weight="300"
        fill="url(#accent)"
        opacity="0.7">f</text>
  <!-- Film-reel accent strip at bottom -->
  <rect x="180" y="876" width="664" height="8" rx="4" fill="url(#accent)" opacity="0.5"/>
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
