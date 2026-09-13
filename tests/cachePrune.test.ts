import { describe, it, expect } from "vitest";
import { computeCacheKeysToKeep, pruneOmdbCache } from "../src/cachePrune";

describe("computeCacheKeysToKeep", () => {
  it("keeps series and season keys for live IMDb ids", () => {
    const keys = ["tt001:series", "tt001:1", "tt001:2", "tt002:series"];
    const kept = computeCacheKeysToKeep(keys, new Set(["tt001", "tt002"]));
    expect(kept.sort()).toEqual(keys.sort());
  });

  it("drops keys for IMDb ids no longer tracked", () => {
    const keys = ["tt001:series", "tt001:1", "tt999:series", "tt999:1"];
    const kept = computeCacheKeysToKeep(keys, new Set(["tt001"]));
    expect(kept.sort()).toEqual(["tt001:1", "tt001:series"]);
  });

  it("drops a key with no ':' entirely if its imdb id isn't live", () => {
    const kept = computeCacheKeysToKeep(["nocolon"], new Set(["tt001"]));
    expect(kept).toEqual([]);
  });

  it("returns empty when live set is empty", () => {
    expect(computeCacheKeysToKeep(["tt001:series"], new Set())).toEqual([]);
  });
});

describe("pruneOmdbCache", () => {
  it("removes orphaned entries and reports a count", () => {
    const cache = {
      "tt001:series": { fetchedAt: 1, data: "a" },
      "tt001:1": { fetchedAt: 1, data: "b" },
      "tt999:series": { fetchedAt: 1, data: "c" },
    };
    const { pruned, removedCount } = pruneOmdbCache(cache, new Set(["tt001"]));
    expect(removedCount).toBe(1);
    expect(Object.keys(pruned).sort()).toEqual(["tt001:1", "tt001:series"]);
  });

  it("reports 0 removed and an equal cache when nothing is orphaned", () => {
    const cache = { "tt001:series": { fetchedAt: 1, data: "a" } };
    const { pruned, removedCount } = pruneOmdbCache(cache, new Set(["tt001"]));
    expect(removedCount).toBe(0);
    expect(pruned).toEqual(cache);
  });

  it("removes everything when live set is empty", () => {
    const cache = { "tt001:series": { fetchedAt: 1, data: "a" } };
    const { pruned, removedCount } = pruneOmdbCache(cache, new Set());
    expect(removedCount).toBe(1);
    expect(pruned).toEqual({});
  });
});
