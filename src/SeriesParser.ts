export interface Episode {
  number: number;
  title: string;
  watched: boolean;
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
      current.episodes.push({
        number: parseInt(epMatch[2], 10),
        title: epMatch[3].trim(),
        watched: epMatch[1].toLowerCase() === "x",
        lineIndex: idx,
      });
    }
  });

  return seasons;
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

export function toggleEpisodeLine(bodyLines: string[], lineIndex: number, watched: boolean): string[] {
  const out = [...bodyLines];
  const line = out[lineIndex];
  if (!line) return out;
  out[lineIndex] = watched
    ? line.replace(/^-\s+\[ \]/, "- [x]")
    : line.replace(/^-\s+\[[xX]\]/, "- [ ]");
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
