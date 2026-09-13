export interface Episode {
  number: number;
  title: string;
  watched: boolean;
  watchedDate: string | null;
  lineIndex: number;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface SeriesFrontmatter {
  title: string;
  status: string;
  rating: number | null;
  image: string;
  source_url: string;
}

/**
 * The status values shown in the dashboard/detail-view status pickers, in
 * display order, each paired with its human-readable label.
 */
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "want-to-watch", label: "Wishlist" },
  { value: "watching", label: "Pending" },
  { value: "up-to-date", label: "Up to date" },
  { value: "finished", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
];

export function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

export interface ParsedSeries {
  frontmatter: SeriesFrontmatter;
  seasons: Season[];
  filePath: string;
}

export interface FrontmatterSplit {
  frontmatterBlock: string;
  body: string;
}

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Splits note content into its frontmatter block (including fences and
 * trailing newline) and the remaining body. Content with no frontmatter
 * returns an empty frontmatter block and the whole content as body.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatterBlock: "", body: content };
  }
  return { frontmatterBlock: match[0], body: content.slice(match[0].length) };
}

const SEASON_HEADING_RE = /^##\s+Season\s+(\d+)\s*$/;
const EPISODE_LINE_RE = /^-\s+\[( |x|X)\]\s+E(\d+)\s*(?:—|-)?\s*(.*)$/;
const WATCHED_DATE_SUFFIX_RE = /\s*\(watched:\s*(\d{4}-\d{2}-\d{2})\)\s*$/;

/** Splits an episode's raw trailing text into its title and an optional `(watched: YYYY-MM-DD)` date. */
export function stripWatchedDate(text: string): { title: string; watchedDate: string | null } {
  const m = text.match(WATCHED_DATE_SUFFIX_RE);
  if (!m) return { title: text.trim(), watchedDate: null };
  return { title: text.slice(0, m.index).trim(), watchedDate: m[1] };
}

export function parseSeriesBody(body: string): Season[] {
  const lines = body.split("\n");
  const seasons: Season[] = [];
  let current: Season | null = null;

  lines.forEach((line, idx) => {
    const seasonMatch = line.match(SEASON_HEADING_RE);
    if (seasonMatch) {
      current = { number: parseInt(seasonMatch[1], 10), episodes: [] };
      seasons.push(current);
      return;
    }
    const epMatch = line.match(EPISODE_LINE_RE);
    if (epMatch && current) {
      const { title, watchedDate } = stripWatchedDate(epMatch[3]);
      current.episodes.push({
        number: parseInt(epMatch[2], 10),
        title,
        watched: epMatch[1].toLowerCase() === "x",
        watchedDate,
        lineIndex: idx,
      });
    }
  });

  return seasons;
}

export interface OmdbSeasonEpisodes {
  number: number;
  episodes: { episode: number; title: string }[];
}

export interface MergeResult {
  body: string;
  episodesAdded: number;
  seasonsAdded: number;
}

/**
 * Merges freshly-fetched OMDb season/episode data into an existing note
 * body: appends any episode not already present (by number) to its
 * season's block, and appends a brand-new `## Season N` block for any
 * season not already present. Never touches existing lines — watched
 * state and watched dates on already-tracked episodes are untouched.
 */
export function mergeNewEpisodes(body: string, seasonsData: OmdbSeasonEpisodes[]): MergeResult {
  const lines = body.split("\n");
  let episodesAdded = 0;
  let seasonsAdded = 0;

  const findSeasonHeadingLine = (num: number): number =>
    lines.findIndex((l) => l.match(SEASON_HEADING_RE)?.[1] === String(num));

  const findBlockEnd = (headingLine: number): number => {
    for (let i = headingLine + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) return i;
    }
    return lines.length;
  };

  for (const season of [...seasonsData].sort((a, b) => a.number - b.number)) {
    const headingLine = findSeasonHeadingLine(season.number);

    if (headingLine === -1) {
      // Brand-new season: insert before the first non-season "## " heading
      // (e.g. Notes) if one exists, otherwise at the end of the body.
      let insertAt = lines.findIndex((l) => /^##\s/.test(l) && !SEASON_HEADING_RE.test(l));
      if (insertAt === -1) insertAt = lines.length;
      const newLines = [
        `## Season ${season.number}`,
        ...season.episodes.map((ep) => `- [ ] E${ep.episode} — ${ep.title}`),
        "",
      ];
      lines.splice(insertAt, 0, ...newLines);
      episodesAdded += season.episodes.length;
      seasonsAdded += 1;
      continue;
    }

    const blockEnd = findBlockEnd(headingLine);
    const existingNumbers = new Set<number>();
    // Insert right after the last existing episode line in the block (not
    // at blockEnd) — blockEnd can point past a trailing blank artifact of
    // the body's final newline when this is the last season, which would
    // otherwise leave a stray blank line before the newly-appended episode.
    let lastEpisodeLine = headingLine;
    for (let i = headingLine + 1; i < blockEnd; i++) {
      const m = lines[i].match(EPISODE_LINE_RE);
      if (m) {
        existingNumbers.add(parseInt(m[2], 10));
        lastEpisodeLine = i;
      }
    }
    const missing = season.episodes.filter((ep) => !existingNumbers.has(ep.episode));
    if (missing.length > 0) {
      const insertLines = missing.map((ep) => `- [ ] E${ep.episode} — ${ep.title}`);
      lines.splice(lastEpisodeLine + 1, 0, ...insertLines);
      episodesAdded += missing.length;
    }
  }

  return { body: lines.join("\n"), episodesAdded, seasonsAdded };
}

export function parseFrontmatter(fm: Record<string, any>): SeriesFrontmatter {
  return {
    title: fm.title ?? "",
    status: fm.status ?? "want-to-watch",
    rating: typeof fm.rating === "number" ? fm.rating : null,
    image: fm.image ?? "",
    source_url: fm.source_url ?? "",
  };
}

export function extractImdbId(sourceUrl: string): string | null {
  const m = sourceUrl.match(/title\/(tt\d+)/);
  return m ? m[1] : null;
}

/**
 * Toggles an episode line's checkbox. When checking a box, pass
 * `watchedDate` (e.g. today's date, `YYYY-MM-DD`) to stamp it onto the
 * line as `(watched: YYYY-MM-DD)`; unchecking always strips any existing
 * stamp. Leaves the episode number/title untouched.
 */
export function toggleEpisodeLine(
  bodyLines: string[],
  lineIndex: number,
  watched: boolean,
  watchedDate: string | null = null,
): string[] {
  const out = [...bodyLines];
  const line = out[lineIndex];
  if (!line) return out;

  const epMatch = line.match(EPISODE_LINE_RE);
  if (!epMatch) return out;

  const epNum = epMatch[2];
  const { title } = stripWatchedDate(epMatch[3]);
  const checkbox = watched ? "[x]" : "[ ]";
  const suffix = watched && watchedDate ? ` (watched: ${watchedDate})` : "";
  out[lineIndex] = `- ${checkbox} E${epNum} — ${title}${suffix}`;
  return out;
}

/**
 * Sets or inserts a numeric frontmatter field (e.g. `rating: 4`) inside an
 * already-extracted frontmatter block (fences included). If the key exists
 * its line is replaced; otherwise a new line is inserted just before the
 * closing `---`. `value: null` writes the literal YAML `null`.
 */
export function setFrontmatterNumberField(
  frontmatterBlock: string,
  key: string,
  value: number | null,
): string {
  const valueStr = value === null ? "null" : String(value);
  const lineRe = new RegExp(`^${key}: .*$`, "m");
  if (lineRe.test(frontmatterBlock)) {
    return frontmatterBlock.replace(lineRe, `${key}: ${valueStr}`);
  }
  return frontmatterBlock.replace(/\n---\n?$/, `\n${key}: ${valueStr}\n---\n`);
}

/**
 * Sets or inserts a string frontmatter field (e.g. `status: watching`)
 * inside an already-extracted frontmatter block. Mirrors
 * setFrontmatterNumberField but writes the value unquoted (matches the
 * convention already used for `status`/`source` elsewhere in the vault).
 */
export function setFrontmatterStringField(
  frontmatterBlock: string,
  key: string,
  value: string,
): string {
  const lineRe = new RegExp(`^${key}: .*$`, "m");
  if (lineRe.test(frontmatterBlock)) {
    return frontmatterBlock.replace(lineRe, `${key}: ${value}`);
  }
  return frontmatterBlock.replace(/\n---\n?$/, `\n${key}: ${value}\n---\n`);
}

const NOTES_HEADING_RE = /^## Notes\s*$/m;

/** Returns the free-text content under a `## Notes` heading, if present. */
export function getNotesSection(body: string): string {
  const match = body.match(NOTES_HEADING_RE);
  if (!match || match.index === undefined) return "";
  const after = body.slice(match.index + match[0].length);
  const nextHeading = after.search(/^##\s/m);
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
  return section.trim();
}

/**
 * Replaces (or appends) a `## Notes` section in the body with the given
 * text. Preserves everything else in the body untouched.
 */
export function setNotesSection(body: string, text: string): string {
  const match = body.match(NOTES_HEADING_RE);
  const notesBlock = `## Notes\n${text.trim()}\n`;

  if (!match || match.index === undefined) {
    const trimmed = body.replace(/\n+$/, "");
    return `${trimmed}\n\n${notesBlock}`;
  }

  const before = body.slice(0, match.index);
  const after = body.slice(match.index + match[0].length);
  const nextHeading = after.search(/^##\s/m);
  const rest = nextHeading === -1 ? "" : after.slice(nextHeading);
  return `${before}${notesBlock}${rest ? "\n" + rest : ""}`;
}
