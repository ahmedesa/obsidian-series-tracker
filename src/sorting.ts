export type SortBy = "last-edited" | "title" | "recently-added" | "rating" | "status" | "recently-completed";

/**
 * Dashboard sort options, in the order shown in the dropdown. "Last edited"
 * is the default — before this existed, the grid rendered in whatever
 * arbitrary order the vault happened to return files in, which users found
 * confusing; sorting by the file's own last-modified time (not a frontmatter
 * field) surfaces whatever was most recently touched, which is the most
 * useful "no filter applied" ordering.
 */
export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "last-edited", label: "Last edited" },
  { value: "title", label: "Title (A–Z)" },
  { value: "recently-added", label: "Recently added" },
  { value: "rating", label: "Rating (highest first)" },
  { value: "status", label: "Status" },
  { value: "recently-completed", label: "Recently watched" },
];

export const DEFAULT_SORT_BY: SortBy = "last-edited";

export interface SortableEntry {
  title: string;
  rating: number | null;
  status: string;
  dateAdded: string;
  dateCompleted: string;
  /** The note file's own last-modified time (`TFile.stat.mtime`), not a frontmatter field. */
  mtime: number;
}

/**
 * Sorts a filtered list of shows/movies by the selected criterion. Pure and
 * generic over both series and movie entries — callers pass their own
 * status display-order array (e.g. `STATUS_OPTIONS.map(o => o.value)`) so
 * the "Status" sort groups items the same way the status filter dropdown
 * already orders them, rather than inventing a second ordering.
 */
export function sortEntries<T extends SortableEntry>(entries: T[], sortBy: SortBy, statusOrder: string[]): T[] {
  const sorted = [...entries];

  switch (sortBy) {
    case "last-edited":
      sorted.sort((a, b) => b.mtime - a.mtime);
      break;

    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;

    case "recently-added":
      sorted.sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""));
      break;

    case "rating":
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
      break;

    case "status": {
      const rank = (status: string): number => {
        const i = statusOrder.indexOf(status);
        return i === -1 ? statusOrder.length : i;
      };
      sorted.sort((a, b) => rank(a.status) - rank(b.status));
      break;
    }

    case "recently-completed":
      sorted.sort((a, b) => {
        const aDate = a.dateCompleted || "";
        const bDate = b.dateCompleted || "";
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.localeCompare(aDate);
      });
      break;
  }

  return sorted;
}
