import { describe, it, expect } from "vitest";
import { topRatedGenres, excludeTracked, normalizeTitle } from "../src/recommendations";
import { TmdbSearchResult } from "../src/TmdbClient";

describe("topRatedGenres", () => {
  it("ranks genres by summed rating across rated items", () => {
    const genres = topRatedGenres([
      { genres: ["Drama", "Crime"], rating: 5 },
      { genres: ["Drama"], rating: 4 },
      { genres: ["Comedy"], rating: 3 },
    ]);
    expect(genres).toEqual(["Drama", "Crime", "Comedy"]);
  });

  it("ignores unrated items", () => {
    const genres = topRatedGenres([
      { genres: ["Horror"], rating: null },
      { genres: ["Drama"], rating: 2 },
    ]);
    expect(genres).toEqual(["Drama"]);
  });

  it("returns [] when nothing is rated", () => {
    expect(topRatedGenres([{ genres: ["Drama"], rating: null }])).toEqual([]);
    expect(topRatedGenres([])).toEqual([]);
  });

  it("respects topN and breaks ties alphabetically", () => {
    const genres = topRatedGenres(
      [
        { genres: ["Zeta"], rating: 3 },
        { genres: ["Alpha"], rating: 3 },
        { genres: ["Beta"], rating: 3 },
      ],
      2,
    );
    expect(genres).toEqual(["Alpha", "Beta"]);
  });

  it("ignores blank genre strings", () => {
    expect(topRatedGenres([{ genres: ["", "  "], rating: 5 }])).toEqual([]);
  });
});

describe("excludeTracked", () => {
  function result(title: string): TmdbSearchResult {
    return { tmdbId: 1, title, year: "2020", poster: "", rating: "", plot: "" };
  }

  it("drops candidates whose title matches a tracked title, case/whitespace-insensitive", () => {
    const candidates = [result("Breaking Bad"), result("Better Call Saul")];
    const tracked = new Set([normalizeTitle("  breaking BAD  ")]);
    expect(excludeTracked(candidates, tracked).map((c) => c.title)).toEqual(["Better Call Saul"]);
  });

  it("keeps everything when nothing is tracked", () => {
    const candidates = [result("Breaking Bad")];
    expect(excludeTracked(candidates, new Set())).toEqual(candidates);
  });
});
