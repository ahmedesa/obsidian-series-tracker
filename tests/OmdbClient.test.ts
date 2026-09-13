import { describe, it, expect, vi, beforeEach } from "vitest";
import { OmdbClient } from "../src/OmdbClient";

describe("OmdbClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and caches a season", async () => {
    const mockResponse = {
      Response: "True",
      Episodes: [
        { Title: "Refined Aggression", Episode: "1", Released: "2024-03-07", imdbRating: "8.2" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({ json: async () => mockResponse }) as any;

    const cache: Record<string, any> = {};
    const saveCache = vi.fn(async (c: any) => { Object.assign(cache, c); });
    const client = new OmdbClient("fake-key", cache, saveCache);

    const result = await client.getSeason("tt13210838", 1);

    expect(result).not.toBeNull();
    expect(result!.episodes[0]).toMatchObject({ title: "Refined Aggression", episode: 1 });
    expect(saveCache).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses cache instead of refetching within TTL", async () => {
    global.fetch = vi.fn() as any;
    const cache = {
      "tt123:1": { fetchedAt: Date.now(), data: { season: 1, episodes: [] } },
    };
    const client = new OmdbClient("fake-key", cache, vi.fn());

    const result = await client.getSeason("tt123", 1);

    expect(result).toEqual({ season: 1, episodes: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null with no key and no cache", async () => {
    global.fetch = vi.fn() as any;
    const client = new OmdbClient("", {}, vi.fn());
    const result = await client.getSeason("tt123", 1);
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches and caches series-level info", async () => {
    const mockResponse = {
      Response: "True",
      Plot: "A synopsis.",
      Rated: "TV-MA",
      Runtime: "45 min",
      Country: "United Kingdom, United States",
      Awards: "Won 1 Primetime Emmy.",
      imdbRating: "8.0",
      Genre: "Action, Comedy, Crime",
      Poster: "https://example.com/poster.jpg",
      totalSeasons: "3",
    };
    global.fetch = vi.fn().mockResolvedValue({ json: async () => mockResponse }) as any;

    const cache: Record<string, any> = {};
    const saveCache = vi.fn(async (c: any) => { Object.assign(cache, c); });
    const client = new OmdbClient("fake-key", cache, saveCache);

    const result = await client.getSeries("tt13210838");

    expect(result).toEqual({
      plot: "A synopsis.",
      rated: "TV-MA",
      runtime: "45 min",
      country: "United Kingdom, United States",
      awards: "Won 1 Primetime Emmy.",
      imdbRating: "8.0",
      genre: "Action, Comedy, Crime",
      poster: "https://example.com/poster.jpg",
      totalSeasons: 3,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls[0][0]).not.toContain("Season=");
  });

  it("searches series by title", async () => {
    const mockResponse = {
      Response: "True",
      Search: [
        { Title: "Severance", Year: "2022–", imdbID: "tt11280740", Type: "series", Poster: "https://example.com/severance.jpg" },
        { Title: "Severance", Year: "2014–", imdbID: "tt3476540", Type: "series", Poster: "N/A" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({ json: async () => mockResponse }) as any;
    const client = new OmdbClient("fake-key", {}, vi.fn());

    const results = await client.searchSeries("Severance");

    expect(results).toEqual([
      { title: "Severance", year: "2022–", imdbId: "tt11280740", poster: "https://example.com/severance.jpg" },
      { title: "Severance", year: "2014–", imdbId: "tt3476540", poster: "" },
    ]);
  });

  it("returns an empty array with no key", async () => {
    global.fetch = vi.fn() as any;
    const client = new OmdbClient("", {}, vi.fn());
    const results = await client.searchSeries("Severance");
    expect(results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
