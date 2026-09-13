export interface OmdbEpisode {
  title: string;
  episode: number;
  released: string;
  imdbRating: string;
}

export interface OmdbSeasonResponse {
  season: number;
  episodes: OmdbEpisode[];
}

export interface OmdbSeriesInfo {
  plot: string;
  rated: string;
  runtime: string;
  country: string;
  awards: string;
  imdbRating: string;
}

interface SeasonCacheEntry {
  fetchedAt: number;
  data: OmdbSeasonResponse;
}

interface SeriesCacheEntry {
  fetchedAt: number;
  data: OmdbSeriesInfo;
}

type CacheEntry = SeasonCacheEntry | SeriesCacheEntry;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal fetch abstraction so OmdbClient stays a pure, testable module
 * with no dependency on the `obsidian` package. Production callers should
 * inject a fetcher backed by Obsidian's `requestUrl` (CORS-safe on both
 * desktop and mobile); tests can inject a fake. Defaults to global `fetch`
 * for backwards-compatible testability.
 */
export type OmdbFetcher = (url: string) => Promise<{ json: any }>;

async function defaultFetcher(url: string): Promise<{ json: any }> {
  const res = await fetch(url);
  return { json: await res.json() };
}

export class OmdbClient {
  constructor(
    private apiKey: string,
    private cache: Record<string, CacheEntry>,
    private saveCache: (cache: Record<string, CacheEntry>) => Promise<void>,
    private fetcher: OmdbFetcher = defaultFetcher,
  ) {}

  private cacheKey(imdbId: string, season: number): string {
    return `${imdbId}:${season}`;
  }

  async getSeason(imdbId: string, season: number): Promise<OmdbSeasonResponse | null> {
    const key = this.cacheKey(imdbId, season);
    const cached = this.cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data as OmdbSeasonResponse;
    }
    if (!this.apiKey) return (cached?.data as OmdbSeasonResponse) ?? null;

    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&i=${imdbId}&Season=${season}`;
      const { json } = await this.fetcher(url);
      if (json.Response !== "True") return (cached?.data as OmdbSeasonResponse) ?? null;

      const data: OmdbSeasonResponse = {
        season,
        episodes: (json.Episodes ?? []).map((e: any) => ({
          title: e.Title,
          episode: parseInt(e.Episode, 10),
          released: e.Released,
          imdbRating: e.imdbRating,
        })),
      };
      this.cache[key] = { fetchedAt: Date.now(), data };
      await this.saveCache(this.cache);
      return data;
    } catch {
      return (cached?.data as OmdbSeasonResponse) ?? null;
    }
  }

  async getSeries(imdbId: string): Promise<OmdbSeriesInfo | null> {
    const key = `${imdbId}:series`;
    const cached = this.cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data as OmdbSeriesInfo;
    }
    if (!this.apiKey) return (cached?.data as OmdbSeriesInfo) ?? null;

    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&i=${imdbId}`;
      const { json } = await this.fetcher(url);
      if (json.Response !== "True") return (cached?.data as OmdbSeriesInfo) ?? null;

      const data: OmdbSeriesInfo = {
        plot: json.Plot ?? "",
        rated: json.Rated ?? "",
        runtime: json.Runtime ?? "",
        country: json.Country ?? "",
        awards: json.Awards ?? "",
        imdbRating: json.imdbRating ?? "",
      };
      this.cache[key] = { fetchedAt: Date.now(), data };
      await this.saveCache(this.cache);
      return data;
    } catch {
      return (cached?.data as OmdbSeriesInfo) ?? null;
    }
  }
}
