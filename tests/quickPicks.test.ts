import { describe, it, expect } from "vitest";
import { findQuickPicks, QuickPickShow } from "../src/quickPicks";

function ep(number: number, watched: boolean) {
  return { number, title: `E${number}`, watched, watchedDate: watched ? "2026-09-01" : null, lineIndex: 0 };
}

describe("findQuickPicks", () => {
  it("excludes shows with zero unwatched episodes", () => {
    const shows: QuickPickShow[] = [
      {
        title: "Finished Show",
        image: "a.jpg",
        filePath: "a.md",
        seasons: [{ number: 1, episodes: [ep(1, true), ep(2, true)] }],
      },
    ];
    expect(findQuickPicks(shows)).toEqual([]);
  });

  it("sorts by fewest unwatched episodes first", () => {
    const shows: QuickPickShow[] = [
      {
        title: "Many Left",
        image: "a.jpg",
        filePath: "a.md",
        seasons: [{ number: 1, episodes: [ep(1, false), ep(2, false), ep(3, false)] }],
      },
      {
        title: "Almost Done",
        image: "b.jpg",
        filePath: "b.md",
        seasons: [{ number: 1, episodes: [ep(1, true), ep(2, false)] }],
      },
    ];
    const result = findQuickPicks(shows);
    expect(result.map((r) => r.title)).toEqual(["Almost Done", "Many Left"]);
    expect(result[0].unwatchedCount).toBe(1);
    expect(result[1].unwatchedCount).toBe(3);
  });

  it("breaks ties alphabetically by title", () => {
    const shows: QuickPickShow[] = [
      {
        title: "Zebra",
        image: "",
        filePath: "z.md",
        seasons: [{ number: 1, episodes: [ep(1, false)] }],
      },
      {
        title: "Alpha",
        image: "",
        filePath: "a.md",
        seasons: [{ number: 1, episodes: [ep(1, false)] }],
      },
    ];
    const result = findQuickPicks(shows);
    expect(result.map((r) => r.title)).toEqual(["Alpha", "Zebra"]);
  });

  it("counts unwatched episodes across multiple seasons", () => {
    const shows: QuickPickShow[] = [
      {
        title: "Show A",
        image: "",
        filePath: "a.md",
        seasons: [
          { number: 1, episodes: [ep(1, true)] },
          { number: 2, episodes: [ep(1, false), ep(2, false)] },
        ],
      },
    ];
    const result = findQuickPicks(shows);
    expect(result).toHaveLength(1);
    expect(result[0].unwatchedCount).toBe(2);
  });

  it("returns an empty array for no shows", () => {
    expect(findQuickPicks([])).toEqual([]);
  });
});
