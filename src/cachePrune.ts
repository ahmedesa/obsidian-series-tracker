const IMDB_ID_PREFIX_RE = /^tt\d+$/;

/**
 * TMDb cache entries are keyed either per-item — `<imdbId>:series`,
 * `<imdbId>:<season>`, `<imdbId>:resolve`, `<imdbId>:providers:<country>`
 * (IMDb ids never contain a colon, so the first colon always delimits the
 * id — use indexOf, not lastIndexOf, or multi-colon keys mis-key) — or
 * global, not tied to any single item: `genre-map:<mediaType>`,
 * `discover:<mediaType>:<genreIds>`. Only per-item keys are ever pruned;
 * a key whose prefix doesn't look like an IMDb id (`tt<digits>`) is global
 * and always kept. Given the set of IMDb ids still tracked in the vault,
 * returns which cache keys to keep — everything else belongs to a
 * show/movie the user has since deleted.
 */
export function computeCacheKeysToKeep(cacheKeys: string[], liveImdbIds: Set<string>): string[] {
  return cacheKeys.filter((key) => {
    const idx = key.indexOf(":");
    const prefix = idx === -1 ? key : key.slice(0, idx);
    if (!IMDB_ID_PREFIX_RE.test(prefix)) return true;
    return liveImdbIds.has(prefix);
  });
}

/**
 * Removes cache entries for IMDb ids no longer tracked in the vault.
 * Returns the pruned cache and how many entries were removed — callers
 * should skip persisting if removedCount is 0.
 */
export function pruneOmdbCache<T>(
  cache: Record<string, T>,
  liveImdbIds: Set<string>,
): { pruned: Record<string, T>; removedCount: number } {
  const keep = new Set(computeCacheKeysToKeep(Object.keys(cache), liveImdbIds));
  const pruned: Record<string, T> = {};
  let removedCount = 0;
  for (const [key, value] of Object.entries(cache)) {
    if (keep.has(key)) {
      pruned[key] = value;
    } else {
      removedCount++;
    }
  }
  return { pruned, removedCount };
}
