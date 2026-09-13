import { describe, it, expect } from "vitest";
import { findRecentlyWatched, RecentlyWatchedShow } from "../src/recentlyWatched";

function ep(number: number, title: string, watchedDate: string | null) {
  return { number, title, watched: watchedDate !== null, watchedDate, lineIndex: 0 };
}

describe("findRecentlyWatched", () => {
  it("returns only episodes with a watchedDate, most recent first", () => {
    const shows: RecentlyWatchedShow[] = [
      {
        title: "Show A",
        image: "a.jpg",
        seasons: [
          { number: 1, episodes: [ep(1, "Pilot", "2026-09-01"), ep(2, "Second", null)] },
        ],
      },
      {
        title: "Show B",
        image: "b.jpg",
        seasons: [
          { number: 1, episodes: [ep(1, "Opener", "2026-09-10")] },
        ],
      },
    ];

    const result = findRecentlyWatched(shows);

    expect(result).toEqual([
      { showTitle: "Show B", showImage: "b.jpg", season: 1, episode: 1, title: "Opener", watchedDate: "2026-09-10" },
      { showTitle: "Show A", showImage: "a.jpg", season: 1, episode: 1, title: "Pilot", watchedDate: "2026-09-01" },
    ]);
  });

  it("returns an empty array when nothing has been watched", () => {
    const shows: RecentlyWatchedShow[] = [
      { title: "Show A", image: "", seasons: [{ number: 1, episodes: [ep(1, "Pilot", null)] }] },
    ];
    expect(findRecentlyWatched(shows)).toEqual([]);
  });

  it("respects the limit", () => {
    const shows: RecentlyWatchedShow[] = [
      {
        title: "Show A",
        image: "",
        seasons: [
          {
            number: 1,
            episodes: [
              ep(1, "E1", "2026-09-01"),
              ep(2, "E2", "2026-09-02"),
              ep(3, "E3", "2026-09-03"),
            ],
          },
        ],
      },
    ];
    const result = findRecentlyWatched(shows, 2);
    expect(result).toHaveLength(2);
    expect(result[0].watchedDate).toBe("2026-09-03");
    expect(result[1].watchedDate).toBe("2026-09-02");
  });

  it("spans multiple seasons of the same show", () => {
    const shows: RecentlyWatchedShow[] = [
      {
        title: "Show A",
        image: "",
        seasons: [
          { number: 1, episodes: [ep(1, "S1E1", "2026-08-01")] },
          { number: 2, episodes: [ep(1, "S2E1", "2026-09-01")] },
        ],
      },
    ];
    const result = findRecentlyWatched(shows);
    expect(result.map((r) => r.title)).toEqual(["S2E1", "S1E1"]);
  });
});
