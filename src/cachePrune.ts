/**
 * OMDb cache entries are keyed `<imdbId>:series` or `<imdbId>:<season>`
 * (see OmdbClient's cacheKey/getSeries). Given the set of IMDb ids still
 * tracked in the vault, returns which cache keys to keep — everything else
 * belongs to a show/movie the user has since deleted.
 */
export function computeCacheKeysToKeep(cacheKeys: string[], liveImdbIds: Set<string>): string[] {
  return cacheKeys.filter((key) => {
    const idx = key.lastIndexOf(":");
    const imdbId = idx === -1 ? key : key.slice(0, idx);
    return liveImdbIds.has(imdbId);
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
