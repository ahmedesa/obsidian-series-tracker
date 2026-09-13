import { describe, it, expect } from "vitest";
import { findNextUp, findUpcoming, groupUpcomingByDate, formatDateHeading, UpcomingEpisode } from "../src/upcoming";

const NOW = new Date("2026-09-13T12:00:00").getTime();

function ep(overrides: Partial<UpcomingEpisode>): UpcomingEpisode {
  return {
    showTitle: "Show",
    showImage: "",
    filePath: "Show.md",
    season: 1,
    episode: 1,
    title: "Episode",
    released: "2026-09-13",
    lineIndex: 0,
    ...overrides,
  };
}

describe("findNextUp", () => {
  it("picks the oldest aired-but-unwatched episode", () => {
    const candidates = [
      ep({ showTitle: "A", released: "2026-09-10" }),
      ep({ showTitle: "B", released: "2026-09-05" }),
      ep({ showTitle: "C", released: "2026-09-12" }),
    ];
    expect(findNextUp(candidates, NOW)?.showTitle).toBe("B");
  });

  it("ignores episodes that haven't aired yet", () => {
    const candidates = [ep({ showTitle: "Future", released: "2026-09-20" })];
    expect(findNextUp(candidates, NOW)).toBeNull();
  });

  it("ignores episodes with no parseable date", () => {
    const candidates = [ep({ showTitle: "Unknown", released: "N/A" }), ep({ showTitle: "" , released: "" })];
    expect(findNextUp(candidates, NOW)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findNextUp([], NOW)).toBeNull();
  });
});

describe("findUpcoming", () => {
  it("returns only future episodes, soonest first", () => {
    const candidates = [
      ep({ showTitle: "Past", released: "2026-09-01" }),
      ep({ showTitle: "Later", released: "2026-09-20" }),
      ep({ showTitle: "Soon", released: "2026-09-15" }),
    ];
    const result = findUpcoming(candidates, NOW);
    expect(result.map((e) => e.showTitle)).toEqual(["Soon", "Later"]);
  });

  it("excludes episodes with no parseable date", () => {
    const candidates = [ep({ released: "N/A" })];
    expect(findUpcoming(candidates, NOW)).toEqual([]);
  });
});

describe("groupUpcomingByDate", () => {
  it("groups consecutive same-date episodes under one heading", () => {
    const episodes = [
      ep({ showTitle: "A", released: "2026-09-16" }),
      ep({ showTitle: "B", released: "2026-09-16" }),
      ep({ showTitle: "C", released: "2026-09-17" }),
    ];
    const groups = groupUpcomingByDate(episodes);
    expect(groups).toHaveLength(2);
    expect(groups[0].episodes.map((e) => e.showTitle)).toEqual(["A", "B"]);
    expect(groups[1].episodes.map((e) => e.showTitle)).toEqual(["C"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupUpcomingByDate([])).toEqual([]);
  });
});

describe("formatDateHeading", () => {
  it("formats a date as 'Weekday Month D, YYYY'", () => {
    expect(formatDateHeading("2026-09-16")).toBe("Wednesday September 16, 2026");
  });

  it("returns the raw string when unparsable", () => {
    expect(formatDateHeading("N/A")).toBe("N/A");
  });
});
