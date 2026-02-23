import { describe, it, expect, vi } from 'vitest';
import {
  parseSearchResults,
  parseComparisonPage,
  matchFileRuntime,
} from '../../packages/core/src/api/dvdcompare-client.js';
import type {
  DvdCompareDisc,
  DvdCompareSearchResult,
} from '../../packages/core/src/api/dvdcompare-client.js';

// ── parseSearchResults ───────────────────────────────────────────────

describe('parseSearchResults', () => {
  it('should parse search result links with fid, title, and years', () => {
    const html = `
      <div>
        <a href="film.php?fid=12345">Star Trek: The Next Generation (1987-1994)</a>
        <a href="film.php?fid=67890">Star Trek: Deep Space Nine (1993-1999)</a>
      </div>
    `;

    const results = parseSearchResults(html);
    expect(results).toHaveLength(2);

    expect(results[0]).toEqual({
      fid: 12345,
      title: 'Star Trek: The Next Generation',
      years: '1987-1994',
      isBluray: false,
    });

    expect(results[1]).toEqual({
      fid: 67890,
      title: 'Star Trek: Deep Space Nine',
      years: '1993-1999',
      isBluray: false,
    });
  });

  it('should detect Blu-ray entries', () => {
    const html = `
      <a href="film.php?fid=111">Show Name Blu-ray (2010-2015)</a>
      <a href="film.php?fid=222">Show Name BluRay Edition (2010)</a>
      <a href="film.php?fid=333">Show Name DVD (2010-2015)</a>
    `;

    const results = parseSearchResults(html);
    expect(results).toHaveLength(3);
    expect(results[0].isBluray).toBe(true);
    expect(results[1].isBluray).toBe(true);
    expect(results[2].isBluray).toBe(false);
  });

  it('should handle links with /comparisons/ prefix in href', () => {
    const html = `<a href="/comparisons/film.php?fid=42">A Show (2020)</a>`;
    const results = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].fid).toBe(42);
    expect(results[0].title).toBe('A Show');
    expect(results[0].years).toBe('2020');
  });

  it('should handle titles without year parenthetical', () => {
    const html = `<a href="film.php?fid=99">Some Show Without Year</a>`;
    const results = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Some Show Without Year');
    expect(results[0].years).toBe('');
  });

  it('should strip HTML tags from link text', () => {
    const html = `<a href="film.php?fid=55"><b>Bold Show</b> (2022)</a>`;
    const results = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Bold Show');
    expect(results[0].years).toBe('2022');
  });

  it('should handle multiline anchor text', () => {
    // DVDCompare sometimes wraps long titles across lines in the HTML source
    const html = `
      <a href="film.php?fid=65355"
         onmouseover="changeStatus(this, 'Doc latest invention'); return true"
         title="Doc latest invention">
        Venture Bros. (The): Radiant Is the Blood of the Baboon Heart (Blu-ray)
        (2023)
      </a>
    `;

    const results = parseSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].fid).toBe(65355);
    expect(results[0].isBluray).toBe(true);
    expect(results[0].years).toBe('2023');
  });

  it('should parse real DVDCompare search results HTML structure', () => {
    // Real HTML structure from DVDCompare search for "venture bros"
    const html = `
      <ul style="list-style-type:none;padding:0;margin-left:0">
        <li>
          <strong>
            <a href="film.php?fid=65355" title="Doc latest invention">
              Venture Bros. (The): Radiant Is the Blood of the Baboon Heart (Blu-ray) (2023)
            </a>
          </strong>
          <i>Winner: Draw </i>| Blu-ray ALL(America) vs Blu-ray ALL(Canada)
        </li>
        <li>
          <strong>
            <a href="film.php?fid=45813" title="Test">
              Venture Bros. (The): Season 1 (TV)  (2003-2004)
            </a>
          </strong>
          <i>Winner: R1 </i>| R1(America)
        </li>
        <li>
          <strong>
            <a href="film.php?fid=39403" title="Test">
              Venture Bros. (The): Season 3 (TV) (Blu-ray)  (2008)
            </a>
          </strong>
          <i>Winner: Blu-ray ALL </i>| Blu-ray ALL(America)
        </li>
      </ul>
    `;

    const results = parseSearchResults(html);
    expect(results).toHaveLength(3);

    // Movie/special - Blu-ray
    expect(results[0].fid).toBe(65355);
    expect(results[0].isBluray).toBe(true);
    expect(results[0].years).toBe('2023');

    // Season 1 - DVD
    expect(results[1].fid).toBe(45813);
    expect(results[1].isBluray).toBe(false);
    expect(results[1].years).toBe('2003-2004');

    // Season 3 - Blu-ray
    expect(results[2].fid).toBe(39403);
    expect(results[2].isBluray).toBe(true);
    expect(results[2].years).toBe('2008');
  });

  it('should return empty array for HTML with no matching links', () => {
    const html = `<div><a href="other.php?id=1">Not a film link</a></div>`;
    const results = parseSearchResults(html);
    expect(results).toHaveLength(0);
  });
});

// ── parseComparisonPage ──────────────────────────────────────────────

describe('parseComparisonPage', () => {
  it('should parse disc headers and episode entries', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes (with Play All function)
        <br />- "Encounter at Farpoint" (91:22)
        <br />- "The Naked Now" (45:34)
        <br />- "Code of Honor" (45:30)
        <br />Episodic Promos
        <br />- "Promo 1" (0:30)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(1);
    expect(discs[0].discNumber).toBe(1);
    expect(discs[0].discLabel).toBe('DISC ONE');
    expect(discs[0].episodes).toHaveLength(3);

    expect(discs[0].episodes[0]).toEqual({
      title: 'Encounter at Farpoint',
      runtimeSeconds: 91 * 60 + 22,
      runtimeFormatted: '91:22',
    });

    expect(discs[0].episodes[1]).toEqual({
      title: 'The Naked Now',
      runtimeSeconds: 45 * 60 + 34,
      runtimeFormatted: '45:34',
    });

    expect(discs[0].episodes[2]).toEqual({
      title: 'Code of Honor',
      runtimeSeconds: 45 * 60 + 30,
      runtimeFormatted: '45:30',
    });
  });

  it('should parse multiple discs', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes
        <br />- "Episode 1" (44:00)
        <br />- "Episode 2" (43:30)
        <b>DISC TWO</b>
        <br />Episodes
        <br />- "Episode 3" (45:00)
        <br />- "Episode 4" (44:15)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(2);

    expect(discs[0].discNumber).toBe(1);
    expect(discs[0].episodes).toHaveLength(2);
    expect(discs[0].episodes[0].title).toBe('Episode 1');

    expect(discs[1].discNumber).toBe(2);
    expect(discs[1].episodes).toHaveLength(2);
    expect(discs[1].episodes[0].title).toBe('Episode 3');
  });

  it('should sort discs by number', () => {
    const html = `
      <div class="description">
        <b>DISC THREE</b>
        <br />Episodes
        <br />- "Ep C" (42:00)
        <b>DISC ONE</b>
        <br />Episodes
        <br />- "Ep A" (44:00)
        <b>DISC TWO</b>
        <br />Episodes
        <br />- "Ep B" (43:00)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(3);
    expect(discs[0].discNumber).toBe(1);
    expect(discs[1].discNumber).toBe(2);
    expect(discs[2].discNumber).toBe(3);
  });

  it('should deduplicate disc listings (regional duplicates)', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes
        <br />- "Episode 1" (44:00)
        <br />- "Episode 2" (43:30)
        <b>DISC ONE</b>
        <br />Episodes
        <br />- "Episode 1 (Region B)" (44:01)
        <br />- "Episode 2 (Region B)" (43:31)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(1);
    expect(discs[0].episodes).toHaveLength(2);
    // Should use first occurrence
    expect(discs[0].episodes[0].title).toBe('Episode 1');
    expect(discs[0].episodes[0].runtimeSeconds).toBe(44 * 60);
  });

  it('should handle H:MM:SS format for long episodes', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes
        <br />- "Long Episode" (1:30:00)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(1);
    expect(discs[0].episodes[0].runtimeSeconds).toBe(1 * 3600 + 30 * 60);
    expect(discs[0].episodes[0].runtimeFormatted).toBe('1:30:00');
  });

  it('should handle numeric disc labels', () => {
    const html = `
      <div class="description">
        <b>DISC 1</b>
        <br />Episodes
        <br />- "Episode A" (45:00)
        <b>DISC 2</b>
        <br />Episodes
        <br />- "Episode B" (44:00)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(2);
    expect(discs[0].discNumber).toBe(1);
    expect(discs[1].discNumber).toBe(2);
  });

  it('should stop at BONUS disc headers', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes
        <br />- "Episode 1" (44:00)
        <b>BONUS DISC</b>
        <br />Features
        <br />- "Behind the Scenes" (30:00)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(1);
    expect(discs[0].episodes).toHaveLength(1);
  });

  it('should return empty array when no discs are found', () => {
    const html = `<div>No relevant content here</div>`;
    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(0);
  });

  it('should skip episodes section header line itself', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes (with Play All function)
        <br />- "First" (42:15)
        <br />- "Second" (43:10)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs[0].episodes).toHaveLength(2);
    expect(discs[0].episodes[0].title).toBe('First');
  });

  it('should parse numbered episodes (e.g., - 1 "Title" (MM:SS))', () => {
    // DVDCompare sometimes includes episode numbers before the title.
    // This is the real format used on Venture Bros Season 3 Blu-ray (fid=39403).
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes (with Play All) (296:47)
        <br />- 1 "Shadowman 9: In the Cradle of Destiny" (23:41)
        <br />- 2 "The Doctor Is Sin" (22:44)
        <br />- 3 "Home Is Where the Hate Is" (22:49)
        <br />- 4 "The Invisible Hand of Fate" (22:51)
        <br />- 5 "The Buddy System" (22:52)
        <br />- 6 "Dr. Quymn, Medicine Woman" (22:49)
        <br />- 7 "What Goes Down, Must Come Up" (22:50)
        <br />- 8 "Tears of a Sea Cow" (22:42)
        <br />- 9 "Now Museum, Now You Don't" (22:44)
        <br />- 10 "The Lepidopterists" (21:47)
        <br />- 11 "Orb" (22:54)
        <br />- 12 "The Family That Stays Together... Part 1" (23:03)
        <br />- 13 "The Family That Stays Together... Part 2" (23:09)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(1);
    expect(discs[0].discNumber).toBe(1);
    expect(discs[0].episodes).toHaveLength(13);

    // First episode
    expect(discs[0].episodes[0]).toEqual({
      title: 'Shadowman 9: In the Cradle of Destiny',
      runtimeSeconds: 23 * 60 + 41,
      runtimeFormatted: '23:41',
    });

    // Double-digit episode number
    expect(discs[0].episodes[9]).toEqual({
      title: 'The Lepidopterists',
      runtimeSeconds: 21 * 60 + 47,
      runtimeFormatted: '21:47',
    });

    // Last episode with ellipsis in title
    expect(discs[0].episodes[12]).toEqual({
      title: 'The Family That Stays Together... Part 2',
      runtimeSeconds: 23 * 60 + 9,
      runtimeFormatted: '23:09',
    });
  });

  it('should parse mix of numbered and unnumbered episodes across discs', () => {
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes (with Play All)
        <br />- "Dia De Los Dangerous!" (22:10)
        <br />- "Careers In Science" (21:35)
        <b>DISC TWO</b>
        <br />Episodes (with Play All)
        <br />- 1 "Numbered Episode One" (22:00)
        <br />- 2 "Numbered Episode Two" (22:30)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(2);

    // Disc 1: unnumbered
    expect(discs[0].episodes).toHaveLength(2);
    expect(discs[0].episodes[0].title).toBe('Dia De Los Dangerous!');

    // Disc 2: numbered
    expect(discs[1].episodes).toHaveLength(2);
    expect(discs[1].episodes[0].title).toBe('Numbered Episode One');
    expect(discs[1].episodes[1].title).toBe('Numbered Episode Two');
  });

  it('should handle Episodes header with Play all option colon variant', () => {
    // Some DVDCompare pages use "Episodes (with 'Play all' option):" format
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes (with 'Play all' option):
        <br />- "Seven Thirty-Seven" (47:15)
        <br />- "Grilled" (47:57)
        <br />Audio commentary on "Seven Thirty-Seven" by cast and crew
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(1);
    expect(discs[0].episodes).toHaveLength(2);
    expect(discs[0].episodes[0].title).toBe('Seven Thirty-Seven');
    expect(discs[0].episodes[1].title).toBe('Grilled');
  });

  it('should handle real-world TNG Season 1 disc structure', () => {
    // Simulates the actual DVDCompare page for Star Trek TNG S1
    const html = `
      <div class="description">
        <b>DISC ONE</b>
        <br />Episodes (with Play All function)
        <br />- "Encounter at Farpoint" (91:22)
        <br />- "The Naked Now" (45:34)
        <br />- "Code of Honor" (45:30)
        <br />Episodic Promos
        <br />- "Encounter at Farpoint" (0:32)
        <b>DISC TWO</b>
        <br />Episodes (with Play All function)
        <br />- "The Last Outpost" (45:36)
        <br />- "Where No One Has Gone Before" (45:34)
        <br />- "Lonely Among Us" (45:33)
        <br />- "Justice" (45:33)
        <br />- "The Battle" (45:31)
        <br />Episodic Promos
        <br />- "The Last Outpost" (0:32)
        <b>DISC THREE</b>
        <br />Episodes (with Play All function)
        <br />- "Hide and Q" (45:32)
        <br />- "Haven" (45:33)
        <br />- "The Big Goodbye" (45:32)
        <br />- "Datalore" (45:33)
        <br />- "Angel One" (45:32)
        <br />Episodic Promos
        <br />- "Hide and Q" (0:30)
        <b>DISC FOUR</b>
        <br />Episodes (with Play All function)
        <br />- "11001001" (45:32)
        <br />- "Too Short a Season" (45:31)
        <br />- "When the Bough Breaks" (45:35)
        <br />- "Home Soil" (45:33)
        <br />- "Coming of Age" (45:29)
        <br />Episodic Promos
        <br />- "11001001" (0:32)
        <b>DISC FIVE</b>
        <br />Episodes (with Play All function)
        <br />- "Heart of Glory" (45:33)
        <br />- "The Arsenal of Freedom" (45:32)
        <br />- "Symbiosis" (45:31)
        <br />- "Skin of Evil" (45:31)
        <br />- "We'll Always Have Paris" (45:31)
        <br />Episodic Promos
        <br />- "Heart of Glory" (0:30)
        <b>DISC SIX</b>
        <br />Episodes (with Play All function)
        <br />- "Conspiracy" (45:36)
        <br />- "The Neutral Zone" (45:34)
        <br />Episodic Promos
        <br />- "Conspiracy" (0:30)
      </div>
    `;

    const discs = parseComparisonPage(html);
    expect(discs).toHaveLength(6);

    // Disc 1: 3 episodes (Encounter at Farpoint is double-length)
    expect(discs[0].episodes).toHaveLength(3);
    expect(discs[0].episodes[0].title).toBe('Encounter at Farpoint');
    expect(discs[0].episodes[0].runtimeSeconds).toBe(91 * 60 + 22); // 5482

    // Disc 2: 5 episodes
    expect(discs[1].episodes).toHaveLength(5);
    expect(discs[1].episodes[0].title).toBe('The Last Outpost');

    // Disc 6: 2 episodes
    expect(discs[5].episodes).toHaveLength(2);
    expect(discs[5].episodes[0].title).toBe('Conspiracy');
    expect(discs[5].episodes[1].title).toBe('The Neutral Zone');

    // Total episodes across all discs
    const totalEps = discs.reduce((sum, d) => sum + d.episodes.length, 0);
    expect(totalEps).toBe(25); // 3 + 5 + 5 + 5 + 5 + 2
  });
});

// ── matchFileRuntime ─────────────────────────────────────────────────

describe('matchFileRuntime', () => {
  // Build disc data matching the TNG Season 1 layout
  const tngDiscs: DvdCompareDisc[] = [
    {
      discNumber: 1,
      discLabel: 'DISC ONE',
      episodes: [
        { title: 'Encounter at Farpoint', runtimeSeconds: 5482, runtimeFormatted: '91:22' },
        { title: 'The Naked Now', runtimeSeconds: 2734, runtimeFormatted: '45:34' },
        { title: 'Code of Honor', runtimeSeconds: 2730, runtimeFormatted: '45:30' },
      ],
    },
    {
      discNumber: 2,
      discLabel: 'DISC TWO',
      episodes: [
        { title: 'The Last Outpost', runtimeSeconds: 2736, runtimeFormatted: '45:36' },
        { title: 'Where No One Has Gone Before', runtimeSeconds: 2734, runtimeFormatted: '45:34' },
        { title: 'Lonely Among Us', runtimeSeconds: 2733, runtimeFormatted: '45:33' },
        { title: 'Justice', runtimeSeconds: 2733, runtimeFormatted: '45:33' },
        { title: 'The Battle', runtimeSeconds: 2731, runtimeFormatted: '45:31' },
      ],
    },
    {
      discNumber: 3,
      discLabel: 'DISC THREE',
      episodes: [
        { title: 'Hide and Q', runtimeSeconds: 2732, runtimeFormatted: '45:32' },
        { title: 'Haven', runtimeSeconds: 2733, runtimeFormatted: '45:33' },
        { title: 'The Big Goodbye', runtimeSeconds: 2732, runtimeFormatted: '45:32' },
        { title: 'Datalore', runtimeSeconds: 2733, runtimeFormatted: '45:33' },
        { title: 'Angel One', runtimeSeconds: 2732, runtimeFormatted: '45:32' },
      ],
    },
  ];

  it('should match file runtime to closest episode within tolerance', () => {
    // File at 2730.2s should match "Code of Honor" (2730s) within 0.2s
    const match = matchFileRuntime(2730.2, tngDiscs);
    expect(match).not.toBeNull();
    expect(match!.episode.title).toBe('Code of Honor');
    expect(match!.discNumber).toBe(1);
    expect(match!.episodeIndex).toBe(2);
    expect(match!.runtimeDiffSeconds).toBeCloseTo(0.2, 1);
  });

  it('should match double-length episode', () => {
    // File at 5481.9s should match "Encounter at Farpoint" (5482s)
    const match = matchFileRuntime(5481.9, tngDiscs);
    expect(match).not.toBeNull();
    expect(match!.episode.title).toBe('Encounter at Farpoint');
    expect(match!.runtimeDiffSeconds).toBeCloseTo(0.1, 1);
  });

  it('should constrain matching to a specific disc', () => {
    // 2734s matches both D1 "The Naked Now" and D2 "Where No One Has Gone Before"
    // Constraining to disc 2 should only match the D2 episode
    const match = matchFileRuntime(2734, tngDiscs, 3, 2);
    expect(match).not.toBeNull();
    expect(match!.episode.title).toBe('Where No One Has Gone Before');
    expect(match!.discNumber).toBe(2);
  });

  it('should return null when no match within tolerance', () => {
    // File at 3000s (50:00) — no episode is close
    const match = matchFileRuntime(3000, tngDiscs);
    expect(match).toBeNull();
  });

  it('should return null for very short file (extras/promos)', () => {
    const match = matchFileRuntime(30, tngDiscs);
    expect(match).toBeNull();
  });

  it('should pick the closest match when multiple are within tolerance', () => {
    // 2733 is the exact runtime for both "Lonely Among Us" and "Justice" on D2
    // and "Haven" and "Datalore" on D3 — should pick first exact match found (D2)
    const match = matchFileRuntime(2733, tngDiscs, 3);
    expect(match).not.toBeNull();
    // Since diff is 0 for multiple, it picks the first one encountered
    expect(match!.runtimeDiffSeconds).toBe(0);
  });

  it('should respect disc constraint even when better match exists on other disc', () => {
    // "Code of Honor" is 2730s on D1
    // Constrain to D3 — best match there is "Hide and Q" at 2732s (diff 2s)
    const match = matchFileRuntime(2730, tngDiscs, 3, 3);
    expect(match).not.toBeNull();
    expect(match!.discNumber).toBe(3);
    expect(match!.runtimeDiffSeconds).toBe(2);
  });

  it('should handle custom tolerance', () => {
    // File at 2740s — closest is "The Last Outpost" at 2736s (4s diff)
    // Default tolerance (3s) should miss
    const noMatch = matchFileRuntime(2740, tngDiscs, 3);
    expect(noMatch).toBeNull();

    // Tolerance of 5s should catch it
    const match = matchFileRuntime(2740, tngDiscs, 5);
    expect(match).not.toBeNull();
    expect(match!.episode.title).toBe('The Last Outpost');
    expect(match!.runtimeDiffSeconds).toBe(4);
  });

  it('should handle empty disc array', () => {
    const match = matchFileRuntime(2730, []);
    expect(match).toBeNull();
  });

  it('should handle disc with no episodes', () => {
    const emptyDiscs: DvdCompareDisc[] = [{
      discNumber: 1,
      discLabel: 'DISC ONE',
      episodes: [],
    }];
    const match = matchFileRuntime(2730, emptyDiscs);
    expect(match).toBeNull();
  });

  describe('sub-second precision matching (real TNG S1 D1 runtimes)', () => {
    // These are the actual file runtimes from the user's MakeMKV rips
    // matched against DVDCompare data

    it('should match title_t01.mkv (2730.2s) to "Code of Honor" (2730s)', () => {
      const match = matchFileRuntime(2730.2, tngDiscs, 3, 1);
      expect(match).not.toBeNull();
      expect(match!.episode.title).toBe('Code of Honor');
      expect(match!.runtimeDiffSeconds).toBeCloseTo(0.2, 1);
    });

    it('should match title_t02.mkv (2734.2s) to "The Naked Now" (2734s)', () => {
      const match = matchFileRuntime(2734.2, tngDiscs, 3, 1);
      expect(match).not.toBeNull();
      expect(match!.episode.title).toBe('The Naked Now');
      expect(match!.runtimeDiffSeconds).toBeCloseTo(0.2, 1);
    });

    it('should match title_t03.mkv (5481.9s) to "Encounter at Farpoint" (5482s)', () => {
      const match = matchFileRuntime(5481.9, tngDiscs, 3, 1);
      expect(match).not.toBeNull();
      expect(match!.episode.title).toBe('Encounter at Farpoint');
      expect(match!.runtimeDiffSeconds).toBeCloseTo(0.1, 1);
    });
  });
});
