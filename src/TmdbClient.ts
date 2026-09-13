import type {
  MetadataProvider,
  MetadataSeason,
  MetadataDetails,
  WatchProvider,
  MetadataSearchResult,
  ResolvedExternalId,
} from "./MetadataProvider";

interface DetailsCacheEntry {
  fetchedAt: number;
  data: MetadataDetails;
}

interface SeasonCacheEntry {
  fetchedAt: number;
  data: MetadataSeason;
}

interface ResolveCacheEntry {
  fetchedAt: number;
  data: ResolvedExternalId;
}

interface ProvidersCacheEntry {
  fetchedAt: number;
  data: WatchProvider[];
}

interface GenreMapCacheEntry {
  fetchedAt: number;
  data: Record<string, number>;
}

interface DiscoverCacheEntry {
  fetchedAt: number;
  data: MetadataSearchResult[];
}

export type CacheEntry =
  | DetailsCacheEntry
  | SeasonCacheEntry
  | ResolveCacheEntry
  | ProvidersCacheEntry
  | GenreMapCacheEntry
  | DiscoverCacheEntry;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_LOGO_BASE = "https://image.tmdb.org/t/p/w92";

/** TMDb tv `status`: "Ended"/"Canceled" mean no more episodes are coming. Exported for testing. */
export function isSeriesEnded(status: string | undefined | null): boolean {
  return status === "Ended" || status === "Canceled";
}

/** Parses a `"45 min"`-style runtime string (as formatted by formatRuntime below) to minutes. */
export function parseRuntimeMinutes(runtime: string | undefined | null): number {
  if (!runtime) return 0;
  const m = runtime.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function formatRuntime(minutes: number | undefined | null): string {
  return minutes && minutes > 0 ? `${minutes} min` : "";
}

function posterUrl(path: string | null | undefined): string {
  return path ? `${TMDB_IMAGE_BASE}${path}` : "";
}

function logoUrl(path: string | null | undefined): string {
  return path ? `${TMDB_LOGO_BASE}${path}` : "";
}

function formatVote(vote: number | undefined | null): string {
  return vote && vote > 0 ? vote.toFixed(1) : "";
}

/** Shared by `searchTitles` and `discover` — both TMDb endpoints return the same result shape. */
function mapSearchEntries(json: unknown, mediaType: "series" | "movie"): MetadataSearchResult[] {
  if (mediaType === "series") {
    const raw = json as TmdbRawSearchResponse<TmdbRawSearchTvEntry>;
    return (raw.results ?? []).map((r) => ({
      tmdbId: r.id,
      title: r.name ?? "",
      year: (r.first_air_date ?? "").slice(0, 4),
      poster: posterUrl(r.poster_path),
      rating: formatVote(r.vote_average),
      plot: r.overview ?? "",
    }));
  }
  const raw = json as TmdbRawSearchResponse<TmdbRawSearchMovieEntry>;
  return (raw.results ?? []).map((r) => ({
    tmdbId: r.id,
    title: r.title ?? "",
    year: (r.release_date ?? "").slice(0, 4),
    poster: posterUrl(r.poster_path),
    rating: formatVote(r.vote_average),
    plot: r.overview ?? "",
  }));
}

interface TmdbGenre {
  id: number;
  name: string;
}

interface TmdbExternalIds {
  imdb_id?: string | null;
}

interface TmdbRawTvDetails {
  name?: string;
  overview?: string;
  first_air_date?: string;
  genres?: TmdbGenre[];
  poster_path?: string | null;
  number_of_seasons?: number;
  status?: string;
  vote_average?: number;
  episode_run_time?: number[];
  origin_country?: string[];
  external_ids?: TmdbExternalIds;
}

interface TmdbRawMovieDetails {
  title?: string;
  overview?: string;
  release_date?: string;
  genres?: TmdbGenre[];
  poster_path?: string | null;
  runtime?: number;
  vote_average?: number;
  production_countries?: { iso_3166_1: string; name: string }[];
  external_ids?: TmdbExternalIds;
}

interface TmdbRawSearchTvEntry {
  id: number;
  name?: string;
  first_air_date?: string;
  poster_path?: string | null;
  vote_average?: number;
  overview?: string;
}

interface TmdbRawSearchMovieEntry {
  id: number;
  title?: string;
  release_date?: string;
  poster_path?: string | null;
  vote_average?: number;
  overview?: string;
}

interface TmdbRawSearchResponse<T> {
  results?: T[];
}

interface TmdbRawSeasonEpisode {
  episode_number?: number;
  name?: string;
  air_date?: string;
  vote_average?: number;
}

interface TmdbRawSeasonResponse {
  episodes?: TmdbRawSeasonEpisode[];
}

interface TmdbRawFindResponse {
  movie_results?: TmdbRawSearchMovieEntry[];
  tv_results?: TmdbRawSearchTvEntry[];
}

interface TmdbRawGenreEntry {
  id: number;
  name: string;
}

interface TmdbRawGenreListResponse {
  genres?: TmdbRawGenreEntry[];
}

interface TmdbRawProviderEntry {
  provider_name?: string;
  logo_path?: string | null;
}

interface TmdbRawCountryProviders {
  flatrate?: TmdbRawProviderEntry[];
}

interface TmdbRawWatchProvidersResponse {
  results?: Record<string, TmdbRawCountryProviders>;
}

/**
 * Minimal fetch abstraction so TmdbClient stays a pure, testable module with
 * no dependency on the `obsidian` package. Production callers must inject a
 * fetcher backed by Obsidian's `requestUrl` (CORS-safe on both desktop and
 * mobile); tests inject a fake backed by `global.fetch`.
 */
export type TmdbFetcher = (url: string) => Promise<{ json: unknown }>;

/**
 * TMDb-backed implementation of `MetadataProvider` — see that interface for
 * the provider-agnostic contract. Notes keep storing an IMDb URL in
 * `source_url` (unchanged frontmatter shape, so existing vaults don't
 * break), but TMDb identifies shows/movies by its own numeric id — so every
 * lookup that starts from a stored IMDb id first resolves it to a TMDb id
 * (via `find/{imdb_id}`, cached permanently under `<imdbId>:resolve` since
 * that mapping never changes) before fetching the actual data.
 *
 * Cache keys deliberately mirror the old OMDb client's `<imdbId>:series` /
 * `<imdbId>:<season>` scheme (plus the new `<imdbId>:resolve` entries) so
 * cachePrune.ts's IMDb-id-prefix pruning logic keeps working unmodified.
 *
 * The tmdbId-based methods (`getDetails`/`getSeason`) are intentionally
 * uncached — they're only used once, right after a search/ID-add, to build
 * a brand-new note. The externalId-based wrappers (`getDetailsByExternalId`/
 * `getSeasonByExternalId`) are the repeated-access hot path (dashboard
 * renders, refresh) and carry the persistent 24h cache.
 */
export class TmdbClient implements MetadataProvider {
  readonly id = "tmdb";
  readonly displayName = "TMDb";

  constructor(
    private apiKey: string,
    private cache: Record<string, CacheEntry>,
    private saveCache: (cache: Record<string, CacheEntry>) => Promise<void>,
    private fetcher: TmdbFetcher,
  ) {}

  /** One-off title search, not cached (queries vary too much to be worth caching). */
  async search(title: string, mediaType: "series" | "movie"): Promise<MetadataSearchResult[]> {
    if (!this.apiKey || !title.trim()) return [];
    const path = mediaType === "series" ? "tv" : "movie";
    try {
      const url = `${TMDB_API_BASE}/search/${path}?api_key=${this.apiKey}&query=${encodeURIComponent(title)}`;
      const { json } = await this.fetcher(url);
      return mapSearchEntries(json, mediaType);
    } catch {
      return [];
    }
  }

  /** Fetches full details for a known TMDb id. Not cached — see class doc. */
  async getDetails(tmdbId: number, mediaType: "series" | "movie"): Promise<MetadataDetails | null> {
    if (!this.apiKey) return null;
    try {
      if (mediaType === "series") {
        const url = `${TMDB_API_BASE}/tv/${tmdbId}?api_key=${this.apiKey}&append_to_response=external_ids`;
        const { json } = await this.fetcher(url);
        const raw = json as TmdbRawTvDetails;
        if (!raw.name) return null;
        return {
          title: raw.name ?? "",
          year: (raw.first_air_date ?? "").slice(0, 4),
          plot: raw.overview ?? "",
          rated: "",
          runtime: formatRuntime(raw.episode_run_time?.[0]),
          country: (raw.origin_country ?? []).join(", "),
          awards: "",
          imdbRating: formatVote(raw.vote_average),
          genre: (raw.genres ?? []).map((g) => g.name).join(", "),
          poster: posterUrl(raw.poster_path),
          totalSeasons: raw.number_of_seasons ?? 0,
          seriesEnded: isSeriesEnded(raw.status),
          type: "series",
          imdbId: raw.external_ids?.imdb_id ?? "",
          tmdbId,
        };
      }
      const url = `${TMDB_API_BASE}/movie/${tmdbId}?api_key=${this.apiKey}&append_to_response=external_ids`;
      const { json } = await this.fetcher(url);
      const raw = json as TmdbRawMovieDetails;
      if (!raw.title) return null;
      return {
        title: raw.title ?? "",
        year: (raw.release_date ?? "").slice(0, 4),
        plot: raw.overview ?? "",
        rated: "",
        runtime: formatRuntime(raw.runtime),
        country: (raw.production_countries ?? []).map((c) => c.name).join(", "),
        awards: "",
        imdbRating: formatVote(raw.vote_average),
        genre: (raw.genres ?? []).map((g) => g.name).join(", "),
        poster: posterUrl(raw.poster_path),
        totalSeasons: 0,
        seriesEnded: true,
        type: "movie",
        imdbId: raw.external_ids?.imdb_id ?? "",
        tmdbId,
      };
    } catch {
      return null;
    }
  }

  /** Fetches one season's episodes for a known TMDb id. Not cached — see class doc. */
  async getSeason(tmdbId: number, season: number): Promise<MetadataSeason | null> {
    if (!this.apiKey) return null;
    try {
      const url = `${TMDB_API_BASE}/tv/${tmdbId}/season/${season}?api_key=${this.apiKey}`;
      const { json } = await this.fetcher(url);
      const raw = json as TmdbRawSeasonResponse;
      if (!raw.episodes) return null;
      return {
        season,
        episodes: raw.episodes.map((e) => ({
          title: e.name ?? "",
          episode: e.episode_number ?? 0,
          released: e.air_date ?? "",
          rating: formatVote(e.vote_average),
        })),
      };
    } catch {
      return null;
    }
  }

  /** Fetches streaming (subscription) providers for a known TMDb id + country. Not cached — see class doc. */
  async getWatchProviders(
    tmdbId: number,
    mediaType: "series" | "movie",
    country: string,
  ): Promise<WatchProvider[]> {
    if (!this.apiKey) return [];
    const path = mediaType === "series" ? "tv" : "movie";
    try {
      const url = `${TMDB_API_BASE}/${path}/${tmdbId}/watch/providers?api_key=${this.apiKey}`;
      const { json } = await this.fetcher(url);
      const raw = json as TmdbRawWatchProvidersResponse;
      const entries = raw.results?.[country.toUpperCase()]?.flatrate ?? [];
      return entries.map((p) => ({ name: p.provider_name ?? "", logo: logoUrl(p.logo_path) }));
    } catch {
      return [];
    }
  }

  /**
   * Resolves a stored IMDb id to its TMDb id + media type, via
   * `find/{imdb_id}`. Cached permanently under `<imdbId>:resolve` — this
   * mapping never changes, so unlike the other caches there's no TTL check.
   */
  async resolveExternalId(imdbId: string): Promise<ResolvedExternalId | null> {
    const key = `${imdbId}:resolve`;
    const cached = this.cache[key];
    if (cached) return (cached as ResolveCacheEntry).data;
    if (!this.apiKey) return null;

    try {
      const url = `${TMDB_API_BASE}/find/${imdbId}?api_key=${this.apiKey}&external_source=imdb_id`;
      const { json } = await this.fetcher(url);
      const raw = json as TmdbRawFindResponse;

      let result: ResolvedExternalId | null = null;
      if (raw.tv_results && raw.tv_results.length > 0) {
        result = { tmdbId: raw.tv_results[0].id, mediaType: "series" };
      } else if (raw.movie_results && raw.movie_results.length > 0) {
        result = { tmdbId: raw.movie_results[0].id, mediaType: "movie" };
      }
      if (!result) return null;

      this.cache[key] = { fetchedAt: Date.now(), data: result };
      await this.saveCache(this.cache);
      return result;
    } catch {
      return null;
    }
  }

  /** Cached (24h), imdbId-based details lookup — the dashboard/detail-view hot path. */
  async getDetailsByExternalId(imdbId: string, forceRefresh = false): Promise<MetadataDetails | null> {
    const key = `${imdbId}:series`;
    const cached = this.cache[key];
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return (cached as DetailsCacheEntry).data;
    }

    const resolved = await this.resolveExternalId(imdbId);
    if (!resolved) return (cached as DetailsCacheEntry | undefined)?.data ?? null;

    const info = await this.getDetails(resolved.tmdbId, resolved.mediaType);
    if (!info) return (cached as DetailsCacheEntry | undefined)?.data ?? null;

    this.cache[key] = { fetchedAt: Date.now(), data: info };
    await this.saveCache(this.cache);
    return info;
  }

  /** Cached (24h), imdbId-based season lookup — the dashboard/detail-view hot path. */
  async getSeasonByExternalId(imdbId: string, season: number, forceRefresh = false): Promise<MetadataSeason | null> {
    const key = `${imdbId}:${season}`;
    const cached = this.cache[key];
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return (cached as SeasonCacheEntry).data;
    }

    const resolved = await this.resolveExternalId(imdbId);
    if (!resolved || resolved.mediaType !== "series") return (cached as SeasonCacheEntry | undefined)?.data ?? null;

    const data = await this.getSeason(resolved.tmdbId, season);
    if (!data) return (cached as SeasonCacheEntry | undefined)?.data ?? null;

    this.cache[key] = { fetchedAt: Date.now(), data };
    await this.saveCache(this.cache);
    return data;
  }

  /** Cached (24h), imdbId-based watch-providers lookup — the dashboard hot path. */
  async getWatchProvidersByExternalId(imdbId: string, country: string): Promise<WatchProvider[]> {
    const key = `${imdbId}:providers:${country.toUpperCase()}`;
    const cached = this.cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return (cached as ProvidersCacheEntry).data;
    }

    const resolved = await this.resolveExternalId(imdbId);
    if (!resolved) return (cached as ProvidersCacheEntry | undefined)?.data ?? [];

    const data = await this.getWatchProviders(resolved.tmdbId, resolved.mediaType, country);
    this.cache[key] = { fetchedAt: Date.now(), data };
    await this.saveCache(this.cache);
    return data;
  }

  /**
   * Maps TMDb genre names (as stored in frontmatter) to TMDb's numeric genre
   * ids, needed for `discover`. Cached permanently under `genre-map:<mediaType>`
   * — TMDb's genre list changes rarely, no TTL check needed.
   */
  async getGenreMap(mediaType: "series" | "movie"): Promise<Record<string, number>> {
    const key = `genre-map:${mediaType}`;
    const cached = this.cache[key];
    if (cached) return (cached as GenreMapCacheEntry).data;
    if (!this.apiKey) return {};

    try {
      const path = mediaType === "series" ? "tv" : "movie";
      const url = `${TMDB_API_BASE}/genre/${path}/list?api_key=${this.apiKey}`;
      const { json } = await this.fetcher(url);
      const raw = json as TmdbRawGenreListResponse;
      const map: Record<string, number> = {};
      for (const g of raw.genres ?? []) map[g.name] = g.id;

      this.cache[key] = { fetchedAt: Date.now(), data: map };
      await this.saveCache(this.cache);
      return map;
    } catch {
      return {};
    }
  }

  /**
   * Popular titles in the given genre ids (TMDb's `discover` endpoint),
   * sorted by popularity. Cached 24h under `discover:<mediaType>:<genreIds>`
   * — the same cache pattern as every other lookup in this client.
   */
  async discover(mediaType: "series" | "movie", genreIds: number[]): Promise<MetadataSearchResult[]> {
    if (genreIds.length === 0) return [];
    const key = `discover:${mediaType}:${[...genreIds].sort((a, b) => a - b).join(",")}`;
    const cached = this.cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return (cached as DiscoverCacheEntry).data;
    }
    if (!this.apiKey) return (cached as DiscoverCacheEntry | undefined)?.data ?? [];

    try {
      const path = mediaType === "series" ? "tv" : "movie";
      const url = `${TMDB_API_BASE}/discover/${path}?api_key=${this.apiKey}&with_genres=${genreIds.join(",")}&sort_by=popularity.desc`;
      const { json } = await this.fetcher(url);
      const data = mapSearchEntries(json, mediaType);

      this.cache[key] = { fetchedAt: Date.now(), data };
      await this.saveCache(this.cache);
      return data;
    } catch {
      return (cached as DiscoverCacheEntry | undefined)?.data ?? [];
    }
  }
}
