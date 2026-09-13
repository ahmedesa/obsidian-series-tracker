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
