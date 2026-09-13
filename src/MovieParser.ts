export {
  splitFrontmatter,
  setFrontmatterNumberField,
  setFrontmatterStringField,
  getNotesSection,
  setNotesSection,
  extractImdbId,
  normalizeFolderPath,
} from "./SeriesParser";
export type { FrontmatterSplit } from "./SeriesParser";

export interface MovieFrontmatter {
  title: string;
  status: string;
  rating: number | null;
  favourite: boolean;
  image: string;
  source_url: string;
  genre: string[];
  date_added: string;
  date_completed: string;
}

/**
 * The status values shown in the movies dashboard/detail-view status
 * pickers, in display order. Unlike series (5 statuses), movies are a
 * single watch — no "up to date"/"abandoned" concept.
 */
export const MOVIE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "want-to-watch", label: "Want to watch" },
  { value: "watching", label: "Watching" },
  { value: "watched", label: "Watched" },
];

export function movieStatusLabel(status: string): string {
  return MOVIE_STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

export function parseMovieFrontmatter(fm: Record<string, any>): MovieFrontmatter {
  return {
    title: fm.title ?? "",
    status: fm.status ?? "want-to-watch",
    rating: typeof fm.rating === "number" ? fm.rating : null,
    favourite: fm.favourite === true,
    image: fm.image ?? "",
    source_url: fm.source_url ?? "",
    genre: Array.isArray(fm.genre) ? fm.genre : [],
    date_added: typeof fm.date_added === "string" ? fm.date_added : "",
    date_completed: typeof fm.date_completed === "string" ? fm.date_completed : "",
  };
}
