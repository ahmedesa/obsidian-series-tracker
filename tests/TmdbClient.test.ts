import { describe, it, expect, vi } from "vitest";
import { TmdbClient, TmdbFetcher, isSeriesEnded, parseRuntimeMinutes, CacheEntry } from "../src/TmdbClient";

function makeFetcher(handler: (url: string) => unknown): TmdbFetcher {
  return async (url: string) => ({ json: handler(url) });
}

function newClient(handler: (url: string) => unknown, cache: Record<string, CacheEntry> = {}) {
  const saveCache = vi.fn(async (c: Record<string, CacheEntry>) => {
    Object.assign(cache, c);
  });
  const client = new TmdbClient("test-key", cache, saveCache, makeFetcher(handler));
  return { client, cache, saveCache };
}

describe("isSeriesEnded", () => {
  it("is true for Ended", () => {
    expect(isSeriesEnded("Ended")).toBe(true);
  });
  it("is true for Canceled", () => {
    expect(isSeriesEnded("Canceled")).toBe(true);
  });
  it("is false for Returning Series", () => {
    expect(isSeriesEnded("Returning Series")).toBe(false);
  });
  it("is false for missing status", () => {
    expect(isSeriesEnded(undefined)).toBe(false);
    expect(isSeriesEnded(null)).toBe(false);
  });
});

describe("parseRuntimeMinutes", () => {
  it("parses a formatted runtime string", () => {
    expect(parseRuntimeMinutes("45 min")).toBe(45);
  });
  it("returns 0 for missing/empty", () => {
    expect(parseRuntimeMinutes("")).toBe(0);
    expect(parseRuntimeMinutes(null)).toBe(0);
  });
});

describe("TmdbClient.searchTitles", () => {
  it("searches tv and maps fields", async () => {
    const { client } = newClient((url) => {
      expect(url).toContain("/search/tv");
      expect(url).toContain("query=Breaking%20Bad");
      return {
        results: [
          {
            id: 1396,
            name: "Breaking Bad",
            first_air_date: "2008-01-20",
            poster_path: "/abc.jpg",
            vote_average: 8.9,
            overview: "A chemistry teacher turns to cooking meth.",
          },
        ],
      };
    });
    const results = await client.searchTitles("Breaking Bad", "series");
    expect(results).toEqual([
      {
        tmdbId: 1396,
        title: "Breaking Bad",
        year: "2008",
        poster: "https://image.tmdb.org/t/p/w500/abc.jpg",
        rating: "8.9",
        plot: "A chemistry teacher turns to cooking meth.",
      },
    ]);
  });

  it("searches movie and maps fields", async () => {
    const { client } = newClient((url) => {
      expect(url).toContain("/search/movie");
      return {
        results: [
          { id: 27205, title: "Inception", release_date: "2010-07-15", poster_path: null, vote_average: 0, overview: "" },
        ],
      };
    });
    const results = await client.searchTitles("Inception", "movie");
    expect(results).toEqual([
      { tmdbId: 27205, title: "Inception", year: "2010", poster: "", rating: "", plot: "" },
    ]);
  });

  it("returns [] with no api key", async () => {
    const client = new TmdbClient("", {}, vi.fn(), makeFetcher(() => ({})));
    expect(await client.searchTitles("x", "series")).toEqual([]);
  });

  it("returns [] on fetch error", async () => {
    const client = new TmdbClient(
      "key",
      {},
      vi.fn(),
      async () => {
        throw new Error("network");
      },
    );
    expect(await client.searchTitles("x", "series")).toEqual([]);
  });
});

describe("TmdbClient.getDetails", () => {
  it("fetches tv details including external_ids", async () => {
    const { client } = newClient((url) => {
      expect(url).toContain("/tv/1396");
      expect(url).toContain("append_to_response=external_ids");
      return {
        name: "Breaking Bad",
        overview: "A chemistry teacher...",
        first_air_date: "2008-01-20",
        genres: [{ id: 18, name: "Drama" }, { id: 80, name: "Crime" }],
        poster_path: "/abc.jpg",
        number_of_seasons: 5,
        status: "Ended",
        vote_average: 8.9,
        episode_run_time: [47],
        origin_country: ["US"],
        external_ids: { imdb_id: "tt0903747" },
      };
    });
    const info = await client.getDetails(1396, "series");
    expect(info).toEqual({
      title: "Breaking Bad",
      year: "2008",
      plot: "A chemistry teacher...",
      rated: "",
      runtime: "47 min",
      country: "US",
      awards: "",
      imdbRating: "8.9",
      genre: "Drama, Crime",
      poster: "https://image.tmdb.org/t/p/w500/abc.jpg",
      totalSeasons: 5,
      seriesEnded: true,
      type: "series",
      imdbId: "tt0903747",
      tmdbId: 1396,
    });
  });

  it("fetches movie details", async () => {
    const { client } = newClient((url) => {
      expect(url).toContain("/movie/27205");
      return {
        title: "Inception",
        overview: "A thief...",
        release_date: "2010-07-15",
        genres: [{ id: 878, name: "Science Fiction" }],
        poster_path: "/xyz.jpg",
        runtime: 148,
        vote_average: 8.3,
        production_countries: [{ iso_3166_1: "US", name: "United States of America" }],
        external_ids: { imdb_id: "tt1375666" },
      };
    });
    const info = await client.getDetails(27205, "movie");
    expect(info?.runtime).toBe("148 min");
    expect(info?.country).toBe("United States of America");
    expect(info?.imdbId).toBe("tt1375666");
    expect(info?.seriesEnded).toBe(true);
    expect(info?.type).toBe("movie");
  });

  it("returns null when response has no name/title", async () => {
    const { client } = newClient(() => ({}));
    expect(await client.getDetails(1, "series")).toBeNull();
  });
});

describe("TmdbClient.getSeason", () => {
  it("fetches and maps season episodes", async () => {
    const { client } = newClient((url) => {
      expect(url).toContain("/tv/1396/season/1");
      return {
        episodes: [
          { episode_number: 1, name: "Pilot", air_date: "2008-01-20", vote_average: 8.2 },
          { episode_number: 2, name: "Cat's in the Bag...", air_date: "2008-01-27", vote_average: 8.1 },
        ],
      };
    });
    const season = await client.getSeason(1396, 1);
    expect(season).toEqual({
      season: 1,
      episodes: [
        { title: "Pilot", episode: 1, released: "2008-01-20", rating: "8.2" },
        { title: "Cat's in the Bag...", episode: 2, released: "2008-01-27", rating: "8.1" },
      ],
    });
  });

  it("returns null when no episodes field", async () => {
    const { client } = newClient(() => ({}));
    expect(await client.getSeason(1, 1)).toBeNull();
  });
});

describe("TmdbClient.resolveFromImdbId", () => {
  it("resolves a tv result and caches it permanently", async () => {
    let callCount = 0;
    const { client, cache } = newClient((url) => {
      callCount++;
      expect(url).toContain("/find/tt0903747");
      expect(url).toContain("external_source=imdb_id");
      return { tv_results: [{ id: 1396, name: "Breaking Bad" }], movie_results: [] };
    });
    const resolved = await client.resolveFromImdbId("tt0903747");
    expect(resolved).toEqual({ tmdbId: 1396, mediaType: "series" });
    expect(cache["tt0903747:resolve"]).toBeDefined();

    // Second call must hit cache, not fetch again.
    await client.resolveFromImdbId("tt0903747");
    expect(callCount).toBe(1);
  });

  it("resolves a movie result", async () => {
    const { client } = newClient(() => ({ tv_results: [], movie_results: [{ id: 27205, title: "Inception" }] }));
    const resolved = await client.resolveFromImdbId("tt1375666");
    expect(resolved).toEqual({ tmdbId: 27205, mediaType: "movie" });
  });

  it("returns null when nothing matches", async () => {
    const { client } = newClient(() => ({ tv_results: [], movie_results: [] }));
    expect(await client.resolveFromImdbId("tt0000000")).toBeNull();
  });
});

describe("TmdbClient.getDetailsByImdbId", () => {
  it("resolves then fetches details, caching under <imdbId>:series", async () => {
    const { client, cache } = newClient((url) => {
      if (url.includes("/find/")) return { tv_results: [{ id: 1396 }], movie_results: [] };
      return {
        name: "Breaking Bad",
        first_air_date: "2008-01-20",
        genres: [],
        number_of_seasons: 5,
        status: "Ended",
        external_ids: { imdb_id: "tt0903747" },
      };
    });
    const info = await client.getDetailsByImdbId("tt0903747");
    expect(info?.title).toBe("Breaking Bad");
    expect(cache["tt0903747:series"]).toBeDefined();
  });

  it("serves from cache within TTL without fetching", async () => {
    const fetcher = vi.fn(async () => ({ json: {} }));
    const cache: Record<string, CacheEntry> = {
      "tt0903747:series": {
        fetchedAt: Date.now(),
        data: {
          title: "Breaking Bad",
          year: "2008",
          plot: "",
          rated: "",
          runtime: "",
          country: "",
          awards: "",
          imdbRating: "",
          genre: "",
          poster: "",
          totalSeasons: 5,
          seriesEnded: true,
          type: "series",
          imdbId: "tt0903747",
          tmdbId: 1396,
        },
      },
    };
    const client = new TmdbClient("key", cache, vi.fn(), fetcher);
    const info = await client.getDetailsByImdbId("tt0903747");
    expect(info?.title).toBe("Breaking Bad");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bypasses cache when forceRefresh is true", async () => {
    const cache: Record<string, CacheEntry> = {
      "tt0903747:resolve": { fetchedAt: Date.now(), data: { tmdbId: 1396, mediaType: "series" } },
      "tt0903747:series": {
        fetchedAt: Date.now(),
        data: {
          title: "Stale Title",
          year: "2008",
          plot: "",
          rated: "",
          runtime: "",
          country: "",
          awards: "",
          imdbRating: "",
          genre: "",
          poster: "",
          totalSeasons: 5,
          seriesEnded: false,
          type: "series",
          imdbId: "tt0903747",
          tmdbId: 1396,
        },
      },
    };
    const { client } = newClient(() => ({
      name: "Breaking Bad",
      first_air_date: "2008-01-20",
      genres: [],
      number_of_seasons: 5,
      status: "Ended",
      external_ids: { imdb_id: "tt0903747" },
    }), cache);
    const info = await client.getDetailsByImdbId("tt0903747", true);
    expect(info?.title).toBe("Breaking Bad");
  });
});

describe("TmdbClient.getSeasonByImdbId", () => {
  it("resolves then fetches season, caching under <imdbId>:<season>", async () => {
    const { client, cache } = newClient((url) => {
      if (url.includes("/find/")) return { tv_results: [{ id: 1396 }], movie_results: [] };
      return { episodes: [{ episode_number: 1, name: "Pilot", air_date: "2008-01-20", vote_average: 8.2 }] };
    });
    const season = await client.getSeasonByImdbId("tt0903747", 1);
    expect(season?.episodes[0].title).toBe("Pilot");
    expect(cache["tt0903747:1"]).toBeDefined();
  });

  it("returns null for a movie imdb id (no seasons)", async () => {
    const { client } = newClient(() => ({ tv_results: [], movie_results: [{ id: 27205 }] }));
    expect(await client.getSeasonByImdbId("tt1375666", 1)).toBeNull();
  });
});
