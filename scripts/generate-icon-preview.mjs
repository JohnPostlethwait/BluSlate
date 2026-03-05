#!/usr/bin/env node

/**
 * Generate BluSlate icon previews — large centered disc + big white gradient B near corner.
 * Outputs numbered PNGs to /tmp/bluslate-icons/ for comparison.
 */

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = '/tmp/bluslate-icons';
const SIZE = 1024;

// ── E1: True-center large disc, big B pushed toward bottom-right ─────
const optionE1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
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
  <!-- Big B — 25% larger, same right/bottom margins -->
  <text x="688" y="947"
        text-anchor="middle"
        font-family="'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="875"
        font-weight="800"
        fill="url(#bGrad)">B</text>
</svg>`;

// ── E2: Same disc, even bigger B, slightly more toward corner ────────
const optionE2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="blue2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#60a5fa"/>
    </linearGradient>
    <radialGradient id="glow2" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#bg2)"/>
  <!-- Glow -->
  <circle cx="512" cy="512" r="450" fill="url(#glow2)"/>
  <!-- Disc — true center, large -->
  <circle cx="512" cy="512" r="430" fill="none" stroke="url(#blue2)" stroke-width="4" opacity="0.6"/>
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
  <!-- Bigger B — closer to corner -->
  <text x="770" y="900"
        text-anchor="middle"
        font-family="'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="780"
        font-weight="800"
        fill="url(#bGrad2)">B</text>
</svg>`;

// ── E3: Same disc, B at 750px, middle ground position ────────────────
const optionE3 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="blue3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#60a5fa"/>
    </linearGradient>
    <radialGradient id="glow3" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f1f5f9"/>
      <stop offset="100%" stop-color="#b4c4d6"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#bg3)"/>
  <!-- Glow -->
  <circle cx="512" cy="512" r="450" fill="url(#glow3)"/>
  <!-- Disc — true center, large -->
  <circle cx="512" cy="512" r="430" fill="none" stroke="url(#blue3)" stroke-width="4" opacity="0.6"/>
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
  <!-- B — 750px, balanced position -->
  <text x="755" y="885"
        text-anchor="middle"
        font-family="'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="750"
        font-weight="800"
        fill="url(#bGrad3)">B</text>
</svg>`;

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const options = [
    { name: 'E1-center-disc-B-corner', svg: optionE1, desc: 'True-center large disc, 700px B pushed to corner' },
    { name: 'E2-center-disc-bigger-B-corner', svg: optionE2, desc: 'True-center large disc, 780px B closer to corner' },
    { name: 'E3-center-disc-B-balanced', svg: optionE3, desc: 'True-center large disc, 750px B balanced position' },
  ];

  for (const opt of options) {
    const outPath = join(OUTPUT_DIR, `icon-${opt.name}.png`);
    await sharp(Buffer.from(opt.svg))
      .resize(SIZE, SIZE)
      .png()
      .toFile(outPath);
    console.log(`  ${opt.name}: ${opt.desc} → ${outPath}`);
  }

  console.log(`\nAll previews saved to ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
