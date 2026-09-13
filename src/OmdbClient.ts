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

interface CacheEntry {
  fetchedAt: number;
  data: OmdbSeasonResponse;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class OmdbClient {
  constructor(
    private apiKey: string,
    private cache: Record<string, CacheEntry>,
    private saveCache: (cache: Record<string, CacheEntry>) => Promise<void>,
  ) {}

  private cacheKey(imdbId: string, season: number): string {
    return `${imdbId}:${season}`;
  }

  async getSeason(imdbId: string, season: number): Promise<OmdbSeasonResponse | null> {
    const key = this.cacheKey(imdbId, season);
    const cached = this.cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data;
    }
    if (!this.apiKey) return cached?.data ?? null;

    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&i=${imdbId}&Season=${season}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.Response !== "True") return cached?.data ?? null;

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
      return cached?.data ?? null;
    }
  }
}
