import { describe, it, expect } from "vitest";
import { sortEntries, SortableEntry } from "../src/sorting";

const STATUS_ORDER = ["want-to-watch", "watching", "up-to-date", "finished", "abandoned"];

function entry(overrides: Partial<SortableEntry> & { title: string }): SortableEntry {
  return {
    rating: null,
    status: "want-to-watch",
    dateAdded: "",
    dateCompleted: "",
    mtime: 0,
    ...overrides,
  };
}

describe("sortEntries", () => {
  it("sorts by last-edited (mtime), most recent first", () => {
    const items = [
      entry({ title: "A", mtime: 100 }),
      entry({ title: "B", mtime: 300 }),
      entry({ title: "C", mtime: 200 }),
    ];
    expect(sortEntries(items, "last-edited", STATUS_ORDER).map((i) => i.title)).toEqual(["B", "C", "A"]);
  });

  it("sorts by title A-Z", () => {
    const items = [entry({ title: "Charlie" }), entry({ title: "alpha" }), entry({ title: "Bravo" })];
    expect(sortEntries(items, "title", STATUS_ORDER).map((i) => i.title)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("sorts by recently added, newest first", () => {
    const items = [
      entry({ title: "A", dateAdded: "2026-01-01" }),
      entry({ title: "B", dateAdded: "2026-06-01" }),
      entry({ title: "C", dateAdded: "" }),
    ];
    expect(sortEntries(items, "recently-added", STATUS_ORDER).map((i) => i.title)).toEqual(["B", "A", "C"]);
  });

  it("sorts by rating, highest first, unrated last", () => {
    const items = [
      entry({ title: "A", rating: 3 }),
      entry({ title: "B", rating: null }),
      entry({ title: "C", rating: 4.5 }),
    ];
    expect(sortEntries(items, "rating", STATUS_ORDER).map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("sorts by status, following the given status display order", () => {
    const items = [
      entry({ title: "A", status: "abandoned" }),
      entry({ title: "B", status: "watching" }),
      entry({ title: "C", status: "want-to-watch" }),
    ];
    expect(sortEntries(items, "status", STATUS_ORDER).map((i) => i.title)).toEqual(["C", "B", "A"]);
  });

  it("sorts unrecognized statuses last", () => {
    const items = [entry({ title: "A", status: "unknown" }), entry({ title: "B", status: "watching" })];
    expect(sortEntries(items, "status", STATUS_ORDER).map((i) => i.title)).toEqual(["B", "A"]);
  });

  it("sorts by recently completed, newest first, uncompleted last", () => {
    const items = [
      entry({ title: "A", dateCompleted: "2026-01-01" }),
      entry({ title: "B", dateCompleted: "" }),
      entry({ title: "C", dateCompleted: "2026-06-01" }),
    ];
    expect(sortEntries(items, "recently-completed", STATUS_ORDER).map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("does not mutate the input array", () => {
    const items = [entry({ title: "B", mtime: 1 }), entry({ title: "A", mtime: 2 })];
    const original = [...items];
    sortEntries(items, "last-edited", STATUS_ORDER);
    expect(items).toEqual(original);
  });
});
