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
  title: string;
  year: string;
  plot: string;
  rated: string;
  runtime: string;
  country: string;
  awards: string;
  imdbRating: string;
  genre: string;
  poster: string;
  totalSeasons: number;
  /** Derived from OMDb's `Year` field: `"2024–"` (ongoing) vs `"2011–2019"` (ended). */
  seriesEnded: boolean;
  /** OMDb's `Type` field (`"series"` or `"movie"`) — used to reject a wrong-type id lookup. */
  type: string;
}

/**
 * OMDb's series `Year` field is `"2011–2019"` for an ended show and
 * `"2024–"` for one still airing — a trailing dash (hyphen or en-dash)
 * with no closing year after it. Exported for testing.
 */
export function isSeriesEnded(year: string | undefined | null): boolean {
  if (!year) return false;
  return !/[-–]\s*$/.test(year.trim());
}

/** Parses OMDb's `Runtime` field (e.g. `"45 min"`) to minutes. 0 if missing/unparsable. */
export function parseRuntimeMinutes(runtime: string | undefined | null): number {
  if (!runtime) return 0;
  const m = runtime.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export interface OmdbSearchResult {
  title: string;
  year: string;
  imdbId: string;
  poster: string;
}

export interface SeasonCacheEntry {
  fetchedAt: number;
  data: OmdbSeasonResponse;
}

export interface SeriesCacheEntry {
  fetchedAt: number;
  data: OmdbSeriesInfo;
}

export type CacheEntry = SeasonCacheEntry | SeriesCacheEntry;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Raw shape of an individual episode entry in OMDb's season response. */
interface OmdbRawEpisode {
  Title?: string;
  Episode?: string;
  Released?: string;
  imdbRating?: string;
}

/** Raw shape of `https://www.omdbapi.com/?i=<id>&Season=<n>`. */
interface OmdbRawSeasonResponse {
  Response: string;
  Episodes?: OmdbRawEpisode[];
}

/** Raw shape of `https://www.omdbapi.com/?i=<id>`. */
interface OmdbRawSeriesResponse {
  Response: string;
  Title?: string;
  Year?: string;
  Plot?: string;
  Rated?: string;
  Runtime?: string;
  Country?: string;
  Awards?: string;
  imdbRating?: string;
  Genre?: string;
  Poster?: string;
  totalSeasons?: string;
  Type?: string;
}

/** Raw shape of an individual result in OMDb's `s=` search response. */
interface OmdbRawSearchEntry {
  Title?: string;
  Year?: string;
  imdbID?: string;
  Poster?: string;
}

/** Raw shape of `https://www.omdbapi.com/?s=<title>&type=<type>`. */
interface OmdbRawSearchResponse {
  Response: string;
  Search?: OmdbRawSearchEntry[];
}

/**
 * Minimal fetch abstraction so OmdbClient stays a pure, testable module
 * with no dependency on the `obsidian` package. Production callers must
 * inject a fetcher backed by Obsidian's `requestUrl` (CORS-safe on both
 * desktop and mobile — raw `fetch` fails under Obsidian's mobile CORS
 * restrictions); tests inject a fake backed by `global.fetch`.
 */
export type OmdbFetcher = (url: string) => Promise<{ json: unknown }>;

export class OmdbClient {
  constructor(
    private apiKey: string,
    private cache: Record<string, CacheEntry>,
    private saveCache: (cache: Record<string, CacheEntry>) => Promise<void>,
    private fetcher: OmdbFetcher,
  ) {}

  private cacheKey(imdbId: string, season: number): string {
    return `${imdbId}:${season}`;
  }

  async getSeason(imdbId: string, season: number, forceRefresh = false): Promise<OmdbSeasonResponse | null> {
    const key = this.cacheKey(imdbId, season);
    const cached = this.cache[key];
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data as OmdbSeasonResponse;
    }
    if (!this.apiKey) return (cached?.data as OmdbSeasonResponse) ?? null;

    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&i=${imdbId}&Season=${season}`;
      const { json } = await this.fetcher(url);
      const raw = json as OmdbRawSeasonResponse;
      if (raw.Response !== "True") return (cached?.data as OmdbSeasonResponse) ?? null;

      const data: OmdbSeasonResponse = {
        season,
        episodes: (raw.Episodes ?? []).map((e) => ({
          title: e.Title ?? "",
          episode: parseInt(e.Episode ?? "0", 10),
          released: e.Released ?? "",
          imdbRating: e.imdbRating ?? "",
        })),
      };
      this.cache[key] = { fetchedAt: Date.now(), data };
      await this.saveCache(this.cache);
      return data;
    } catch {
      return (cached?.data as OmdbSeasonResponse) ?? null;
    }
  }

  async getSeries(imdbId: string, forceRefresh = false): Promise<OmdbSeriesInfo | null> {
    const key = `${imdbId}:series`;
    const cached = this.cache[key];
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data as OmdbSeriesInfo;
    }
    if (!this.apiKey) return (cached?.data as OmdbSeriesInfo) ?? null;

    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&i=${imdbId}`;
      const { json } = await this.fetcher(url);
      const raw = json as OmdbRawSeriesResponse;
      if (raw.Response !== "True") return (cached?.data as OmdbSeriesInfo) ?? null;

      const data: OmdbSeriesInfo = {
        title: raw.Title ?? "",
        year: raw.Year ?? "",
        plot: raw.Plot ?? "",
        rated: raw.Rated ?? "",
        runtime: raw.Runtime ?? "",
        country: raw.Country ?? "",
        awards: raw.Awards ?? "",
        imdbRating: raw.imdbRating ?? "",
        genre: raw.Genre ?? "",
        poster: raw.Poster && raw.Poster !== "N/A" ? raw.Poster : "",
        totalSeasons: parseInt(raw.totalSeasons ?? "0", 10) || 0,
        seriesEnded: isSeriesEnded(raw.Year),
        type: raw.Type ?? "",
      };
      this.cache[key] = { fetchedAt: Date.now(), data };
      await this.saveCache(this.cache);
      return data;
    } catch {
      return (cached?.data as OmdbSeriesInfo) ?? null;
    }
  }

  /** One-off title search, not cached (queries vary too much to be worth caching). */
  async searchTitles(title: string, type: "series" | "movie"): Promise<OmdbSearchResult[]> {
    if (!this.apiKey || !title.trim()) return [];
    try {
      const url = `https://www.omdbapi.com/?apikey=${this.apiKey}&s=${encodeURIComponent(title)}&type=${type}`;
      const { json } = await this.fetcher(url);
      const raw = json as OmdbRawSearchResponse;
      if (raw.Response !== "True") return [];
      return (raw.Search ?? []).map((r) => ({
        title: r.Title ?? "",
        year: r.Year ?? "",
        imdbId: r.imdbID ?? "",
        poster: r.Poster && r.Poster !== "N/A" ? r.Poster : "",
      }));
    } catch {
      return [];
    }
  }
}
