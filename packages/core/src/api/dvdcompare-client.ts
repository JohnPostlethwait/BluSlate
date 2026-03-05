/**
 * DVDCompare.net client — scrapes per-disc episode runtimes for Blu-ray releases.
 *
 * DVDCompare provides to-the-second runtimes for each episode on each disc,
 * which allows definitive episode identification when TMDb's integer-minute
 * runtimes are insufficient (e.g., when all episodes are ~46 min).
 *
 * Flow:
 *   1. Search by show name → get list of comparison page IDs
 *   2. Fetch comparison page → parse disc/episode/runtime data
 *   3. Match file runtimes (to the millisecond) against DVDCompare runtimes
 *      (to the second) for sub-second precision identification
 */

import { logger } from '../utils/logger.js';

const BASE_URL = 'https://www.dvdcompare.net';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 30_000;

// ── Public types ─────────────────────────────────────────────────────

export interface DvdCompareEpisode {
  title: string;
  runtimeSeconds: number;
  runtimeFormatted: string; // "45:30" as it appears on the page
}

export interface DvdCompareDisc {
  discNumber: number;
  discLabel: string; // "DISC ONE", "DISC TWO", etc.
  episodes: DvdCompareEpisode[];
}

export interface DvdCompareResult {
  fid: number;
  title: string;
  discs: DvdCompareDisc[];
}

export interface DvdCompareSearchResult {
  fid: number;
  title: string;
  years: string;
  isBluray: boolean;
  /** Number of episodes with runtime data. Set after pre-fetching the comparison page. */
  episodeCount?: number;
}

// ── Disc label → number mapping ──────────────────────────────────────

const DISC_WORD_TO_NUMBER: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6,
  SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12,
};

function discLabelToNumber(label: string): number {
  // "DISC ONE" → 1, "DISC 1" → 1
  const word = label.replace(/^DISC\s+/i, '').trim().toUpperCase();
  if (DISC_WORD_TO_NUMBER[word] !== undefined) return DISC_WORD_TO_NUMBER[word];
  const num = parseInt(word, 10);
  return isNaN(num) ? 0 : num;
}

// ── Text normalization ────────────────────────────────────────────────

/**
 * Normalize Unicode characters that cause parsing failures.
 *
 * DVDCompare pages often use Windows-1252 curly quotes (bytes 0x93/0x94).
 * Depending on how the response is decoded, these may appear as:
 *   - U+201C/U+201D (proper curly quotes from windows-1252 decoding)
 *   - U+0093/U+0094 (control chars from iso-8859-1 decoding)
 *   - U+FFFD (replacement chars from failed UTF-8 decoding)
 * Our episode regex expects straight ASCII quotes, so all variants
 * must be normalized.
 */
function normalizeText(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // curly double quotes → straight
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes → straight
    .replace(/[\u0093\u0094]/g, '"')               // ISO-8859-1 control chars (Windows-1252 curly double quotes)
    .replace(/[\u0091\u0092]/g, "'")               // ISO-8859-1 control chars (Windows-1252 curly single quotes)
    .replace(/\u2013/g, '\u002D')                   // en dash → hyphen-minus
    .replace(/\u2014/g, '\u002D')                   // em dash → hyphen-minus
    .replace(/\u2026/g, '...')                      // horizontal ellipsis → three dots
    .replace(/\ufffd/g, '"');                        // replacement char → straight quote (common encoding failure)
}

// ── HTTP helpers ─────────────────────────────────────────────────────

/**
 * Decode an HTTP response body with charset detection.
 *
 * DVDCompare pages declare charset=iso-8859-1 but use Windows-1252
 * characters (curly quotes 0x93/0x94) in the 0x80-0x9F range. Per the
 * WHATWG Encoding Standard, iso-8859-1 labels must be treated as
 * windows-1252 — all browsers do this because virtually all content
 * labeled iso-8859-1 actually uses Windows-1252 extensions.
 *
 * Without this remapping, TextDecoder('iso-8859-1') maps 0x93/0x94 to
 * Unicode control characters U+0093/U+0094 instead of curly quotes
 * U+201C/U+201D, causing normalizeText() to miss them.
 */
async function decodeResponse(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || '';
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  let charset = charsetMatch?.[1]?.toLowerCase() || 'utf-8';

  // Per WHATWG Encoding Standard: iso-8859-1 label maps to windows-1252
  if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'iso_8859-1') {
    charset = 'windows-1252';
  }

  let text: string;
  try {
    text = new TextDecoder(charset).decode(buffer);
  } catch {
    // Unknown charset label — fall back to UTF-8
    text = new TextDecoder('utf-8').decode(buffer);
  }

  // If UTF-8 decoding produced replacement characters, retry as windows-1252
  if (text.includes('\ufffd')) {
    try {
      text = new TextDecoder('windows-1252').decode(buffer);
    } catch {
      // windows-1252 not available — keep the UTF-8 result
    }
  }

  return normalizeText(text);
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DVDCompare fetch failed: ${response.status} ${response.statusText}`);
    }

    return decodeResponse(response);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postSearch(query: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/comparisons/search.php`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `param=${encodeURIComponent(query)}&searchtype=text`,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DVDCompare search failed: ${response.status} ${response.statusText}`);
    }

    return decodeResponse(response);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Parsers ──────────────────────────────────────────────────────────

/**
 * Parse search results HTML into structured results.
 */
export function parseSearchResults(html: string): DvdCompareSearchResult[] {
  const results: DvdCompareSearchResult[] = [];

  // Pattern: <a href="film.php?fid=12345">Title (YYYY-YYYY)</a>
  // Use [\s\S]*? instead of .*? to handle multiline anchor text (DVDCompare sometimes
  // wraps long titles across lines in the HTML source).
  const linkPattern = /<a[^>]*href="(?:\/comparisons\/)?film\.php\?fid=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const fid = parseInt(match[1], 10);
    const rawText = match[2].replace(/<[^>]+>/g, '').trim();

    // Extract title and years: "Show Name (YYYY-YYYY)" or "Show Name (YYYY)"
    const titleMatch = rawText.match(/^(.+?)\s*\((\d{4}(?:-\d{4})?)\)\s*$/);
    const title = titleMatch ? titleMatch[1].trim() : rawText;
    const years = titleMatch ? titleMatch[2] : '';

    // Check if it's a Blu-ray entry (indicated in the title or surrounding text)
    const isBluray = /blu-?ray/i.test(rawText);

    results.push({ fid, title, years, isBluray });
  }

  return results;
}

/**
 * Parse a comparison page's HTML to extract per-disc episode data.
 *
 * Structure on the page:
 *   <div class="description">
 *     <b>DISC ONE</b>
 *     Episodes (with Play All function)
 *     - "Episode Title" (MM:SS)
 *     ...
 *     Episodic Promos
 *     ...
 *   </div>
 */
export function parseComparisonPage(html: string): DvdCompareDisc[] {
  const discs: DvdCompareDisc[] = [];

  // Normalize text upfront to handle curly quotes, en/em dashes, etc.
  // This ensures parsing works regardless of whether the HTML came through
  // decodeResponse() (live) or was passed directly (tests).
  html = normalizeText(html);

  // Split by disc headers: <b>DISC ONE</b>, <b>DISC ONE (Season 1)</b>, etc.
  // [^<]* allows optional annotations like "(Season 1)" before the closing </b>.
  // Only match the FIRST occurrence of each disc (pages repeat data for each region)
  const discPattern = /<b>(DISC\s+(?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|\d+))[^<]*<\/b>(.*?)(?=<b>DISC\s|<b>BONUS\s|<\/div>)/gis;
  const seenDiscs = new Set<string>();
  let discMatch;

  while ((discMatch = discPattern.exec(html)) !== null) {
    const discLabel = discMatch[1].trim().toUpperCase();

    // Only process the first occurrence (skip duplicate regional listings)
    if (seenDiscs.has(discLabel)) continue;
    seenDiscs.add(discLabel);

    const discContent = discMatch[2];
    const discNumber = discLabelToNumber(discLabel);
    if (discNumber === 0) continue;

    // Extract episodes from the "Episodes" section only (not promos/extras)
    const episodes: DvdCompareEpisode[] = [];

    // Split into lines and find the episodes section
    const lines = discContent.split(/<br\s*\/?>/i);
    let inEpisodesSection = false;

    for (const line of lines) {
      const cleaned = line.replace(/<[^>]+>/g, '').replace(/\r|\n/g, '').trim();

      // Detect start of episodes section
      // Handles: "Episodes", "Episodes:", "Episodes (with Play All)",
      // "7 Episodes:", "2 Episodes:", "4 Episodes:" (count-prefixed)
      if (/^(?:\d+\s+)?Episodes?\b/i.test(cleaned) && !/Promo/i.test(cleaned)) {
        inEpisodesSection = true;
        continue;
      }

      // Detect end of episodes section (promos, featurettes, archives, etc.)
      if (
        inEpisodesSection &&
        cleaned.length > 0 &&
        !cleaned.startsWith('-') &&
        !/^\(\d/.test(cleaned)
      ) {
        inEpisodesSection = false;
        continue;
      }

      if (!inEpisodesSection) continue;

      // Parse episode entry. DVDCompare uses several formats:
      //   - "Episode Title" (MM:SS)                          — basic
      //   - 1 "Episode Title" (MM:SS)                        — numbered
      //   - 6.01: "Episode Title" (MM:SS)                    — decimal numbered
      //   - "Episode Title" (H:MM:SS)                        — long-form runtime
      //   - "Episode Title" (annotation) (MM:SS)             — parenthetical before runtime
      //   - "Episode Title (MM:SS)                           — missing closing quote
      const epMatch = cleaned.match(
        /^-\s*(?:\d+(?:\.\d+)?:?\s+)?"([^"]+)"\s*(?:\([^)]*\)\s*)*\((\d{1,3}:\d{2}(?::\d{2})?)\)/,
      );
      // Fallback: missing closing quote — - "Title (MM:SS)
      const unclosedMatch =
        !epMatch &&
        cleaned.match(/^-\s*(?:\d+(?:\.\d+)?:?\s+)?"([^"(]+)\s*\((\d{1,3}:\d{2}(?::\d{2})?)\)/);
      const match = epMatch || unclosedMatch;
      if (match) {
        const title = match[1].trim();
        const runtimeFormatted = match[2];

        // Parse MM:SS or H:MM:SS to seconds
        const parts = runtimeFormatted.split(':').map(Number);
        const runtimeSeconds =
          parts.length === 3
            ? parts[0] * 3600 + parts[1] * 60 + parts[2]
            : parts[0] * 60 + parts[1];

        episodes.push({ title, runtimeSeconds, runtimeFormatted });
      }
    }

    if (episodes.length > 0) {
      discs.push({ discNumber, discLabel, episodes });
    }
  }

  // Sort by disc number
  discs.sort((a, b) => a.discNumber - b.discNumber);

  return discs;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Search DVDCompare for a show by name.
 * Returns search results, preferring Blu-ray entries.
 */
export async function searchDvdCompare(query: string): Promise<DvdCompareSearchResult[]> {
  logger.batch(`DVDCompare: searching for "${query}"`);

  try {
    const html = await postSearch(query);
    const results = parseSearchResults(html);

    logger.batch(`DVDCompare: found ${results.length} result(s) (${results.filter((r) => r.isBluray).length} Blu-ray)`);

    return results;
  } catch (err) {
    logger.warn(`DVDCompare search failed: ${err}`);
    return [];
  }
}

/**
 * Fetch and parse disc/episode data from a DVDCompare comparison page.
 */
export async function fetchDiscEpisodeData(fid: number): Promise<DvdCompareResult | null> {
  const url = `${BASE_URL}/comparisons/film.php?fid=${fid}`;
  logger.batch(`DVDCompare: fetching comparison page fid=${fid}`);

  try {
    const html = await fetchPage(url);
    const discs = parseComparisonPage(html);

    if (discs.length === 0) {
      logger.batch(`DVDCompare: no disc data found for fid=${fid}`);
      return null;
    }

    // Extract title from page
    const titleMatch = html.match(/<title[^>]*>.*?-\s*(.*?)(?:\s*\(|<\/title>)/i);
    const title = titleMatch ? titleMatch[1].trim() : `fid=${fid}`;

    const totalEpisodes = discs.reduce((sum, d) => sum + d.episodes.length, 0);
    logger.batch(
      `DVDCompare: parsed ${discs.length} disc(s), ${totalEpisodes} episode(s) for "${title}"`,
    );

    return { fid, title, discs };
  } catch (err) {
    logger.warn(`DVDCompare fetch failed for fid=${fid}: ${err}`);
    return null;
  }
}

