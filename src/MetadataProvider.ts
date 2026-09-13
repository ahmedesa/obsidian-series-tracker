import { requestUrl } from "obsidian";
import { TmdbClient, TmdbFetcher, CacheEntry } from "./TmdbClient";

export interface MetadataEpisode {
  title: string;
  episode: number;
  released: string;
  /** Provider's own vote average, formatted to 1 decimal. Not necessarily IMDb's rating. */
  rating: string;
}

export interface MetadataSeason {
  season: number;
  episodes: MetadataEpisode[];
}

/** Used for both series and movie details — some fields are series-only (totalSeasons/seriesEnded). */
export interface MetadataDetails {
  title: string;
  year: string;
  plot: string;
  rated: string;
  runtime: string;
  country: string;
  awards: string;
  /** Provider's own public rating, formatted to 1 decimal. Not necessarily IMDb's rating. */
  imdbRating: string;
  genre: string;
  poster: string;
  totalSeasons: number;
  seriesEnded: boolean;
  type: string;
  /** "" if the provider has no linked IMDb entry. */
  imdbId: string;
  /** The provider's own internal numeric id for this title. */
  tmdbId: number;
}

export interface WatchProvider {
  name: string;
  logo: string;
}

export interface MetadataSearchResult {
  /** The provider's own internal numeric id for this title. */
  tmdbId: number;
  title: string;
  year: string;
  poster: string;
  rating: string;
  plot: string;
}

export interface ResolvedExternalId {
  tmdbId: number;
  mediaType: "series" | "movie";
}

/**
 * Provider-agnostic metadata source (search, details, seasons, watch
 * providers, genre discovery). `TmdbClient` is the sole implementation
 * today; adding a second metadata source later means writing a new class
 * that implements this interface and wiring it into
 * `createMetadataProvider` below — not another rewrite across every view
 * that consumes metadata.
 */
export interface MetadataProvider {
  readonly id: string;
  readonly displayName: string;

  /** One-off title search. */
  search(title: string, mediaType: "series" | "movie"): Promise<MetadataSearchResult[]>;

  /** Full details for a known provider-native id. */
  getDetails(id: number, mediaType: "series" | "movie"): Promise<MetadataDetails | null>;

  /** One season's episodes for a known provider-native id. */
  getSeason(id: number, season: number): Promise<MetadataSeason | null>;

  /** Streaming (subscription) providers for a known provider-native id + country. */
  getWatchProviders(id: number, mediaType: "series" | "movie", country: string): Promise<WatchProvider[]>;

  /** Resolves a stored IMDb id to this provider's native id + media type. */
  resolveExternalId(imdbId: string): Promise<ResolvedExternalId | null>;

  /** Cached, IMDb-id-based details lookup — the repeated-access hot path (dashboard renders, refresh). */
  getDetailsByExternalId(imdbId: string, forceRefresh?: boolean): Promise<MetadataDetails | null>;

  /** Cached, IMDb-id-based season lookup — the repeated-access hot path. */
  getSeasonByExternalId(imdbId: string, season: number, forceRefresh?: boolean): Promise<MetadataSeason | null>;

  /** Cached, IMDb-id-based watch-providers lookup. */
  getWatchProvidersByExternalId(imdbId: string, country: string): Promise<WatchProvider[]>;

  /** Maps genre names (as stored in frontmatter) to the provider's numeric genre ids. */
  getGenreMap(mediaType: "series" | "movie"): Promise<Record<string, number>>;

  /** Popular titles in the given genre ids, for recommendations. */
  discover(mediaType: "series" | "movie", genreIds: number[]): Promise<MetadataSearchResult[]>;
}

const obsidianTmdbFetcher: TmdbFetcher = async (url) => {
  const res = await requestUrl({ url });
  return { json: res.json };
};

export interface MetadataProviderSettings {
  metadataProvider: string;
  tmdbApiKey: string;
  tmdbCache: Record<string, CacheEntry>;
}

/**
 * Constructs the active `MetadataProvider` from settings, and persists any
 * cache writes via `saveCache`. Currently always returns a `TmdbClient` —
 * this is the seam a future `settings.metadataProvider` switch plugs into
 * without any call site needing to change.
 */
export function createMetadataProvider(
  settings: MetadataProviderSettings,
  saveCache: (cache: Record<string, CacheEntry>) => Promise<void>,
): MetadataProvider {
  return new TmdbClient(settings.tmdbApiKey, settings.tmdbCache, saveCache, obsidianTmdbFetcher);
}
