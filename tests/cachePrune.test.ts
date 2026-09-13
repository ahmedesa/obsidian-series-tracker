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

  it("keeps a key whose prefix doesn't look like an IMDb id, regardless of live set", () => {
    // A prefix that isn't `tt<digits>` isn't a per-item key at all — it's
    // global (see genre-map/discover below) or malformed, and either way
    // pruning it based on an unrelated "is this an IMDb id" set would be
    // wrong, so such keys are always kept.
    const kept = computeCacheKeysToKeep(["nocolon"], new Set(["tt001"]));
    expect(kept).toEqual(["nocolon"]);
  });

  it("returns empty when live set is empty and every key is IMDb-id-prefixed", () => {
    expect(computeCacheKeysToKeep(["tt001:series"], new Set())).toEqual([]);
  });

  it("keeps multi-colon provider keys for live IMDb ids (imdbId never contains a colon)", () => {
    const keys = ["tt001:providers:US", "tt001:providers:GB", "tt999:providers:US"];
    const kept = computeCacheKeysToKeep(keys, new Set(["tt001"]));
    expect(kept.sort()).toEqual(["tt001:providers:GB", "tt001:providers:US"]);
  });

  it("always keeps global genre-map/discover keys, even with an empty live set", () => {
    const keys = ["genre-map:series", "genre-map:movie", "discover:series:18,80", "tt001:series"];
    const kept = computeCacheKeysToKeep(keys, new Set());
    expect(kept.sort()).toEqual(["discover:series:18,80", "genre-map:movie", "genre-map:series"]);
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
