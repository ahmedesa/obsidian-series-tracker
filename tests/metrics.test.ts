import { describe, it, expect } from "vitest";
import { countGenres, computeTasteIndex } from "../src/metrics";

describe("countGenres", () => {
  it("ranks genres by tracked-item count, descending", () => {
    const result = countGenres([["Drama", "Crime"], ["Drama"], ["Comedy"]]);
    expect(result).toEqual([
      { genre: "Drama", count: 2 },
      { genre: "Comedy", count: 1 },
      { genre: "Crime", count: 1 },
    ]);
  });

  it("ignores blank genre strings", () => {
    expect(countGenres([["", "  "]])).toEqual([]);
  });

  it("returns [] for no items", () => {
    expect(countGenres([])).toEqual([]);
  });
});

describe("computeTasteIndex", () => {
  it("computes per-genre my-vs-public average on a 0-5 scale", () => {
    const result = computeTasteIndex([
      { genres: ["Drama"], myRating: 5, publicRating: 8 },
      { genres: ["Drama"], myRating: 3, publicRating: 6 },
    ]);
    expect(result).toEqual([{ genre: "Drama", myAvg: 4, publicAvg: 3.5, diff: 0.5 }]);
  });

  it("skips items missing either rating", () => {
    const result = computeTasteIndex([
      { genres: ["Drama"], myRating: null, publicRating: 8 },
      { genres: ["Comedy"], myRating: 4, publicRating: null },
    ]);
    expect(result).toEqual([]);
  });

  it("sorts by diff descending, ties broken alphabetically", () => {
    const result = computeTasteIndex([
      { genres: ["Zeta"], myRating: 5, publicRating: 0 },
      { genres: ["Alpha"], myRating: 5, publicRating: 0 },
    ]);
    expect(result.map((r) => r.genre)).toEqual(["Alpha", "Zeta"]);
  });

  it("returns [] for no qualifying entries", () => {
    expect(computeTasteIndex([])).toEqual([]);
  });
});
