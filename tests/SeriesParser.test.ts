import { describe, it, expect } from "vitest";
import {
  parseSeriesBody,
  parseFrontmatter,
  extractImdbId,
  toggleEpisodeLine,
  stripWatchedDate,
  splitFrontmatter,
  setFrontmatterNumberField,
  setFrontmatterStringField,
  getNotesSection,
  setNotesSection,
  mergeNewEpisodes,
  deriveStatus,
  normalizeFolderPath,
  parseImdbId,
} from "../src/SeriesParser";

describe("parseSeriesBody", () => {
  it("parses seasons and episodes with watched state", () => {
    const body = [
      "## Season 1",
      "- [x] E1 — Refined Aggression",
      "- [ ] E2 — Tackle Tommy Woo Woo",
      "",
      "## Season 2",
      "- [ ] E1 — The Road to Kingdom",
    ].join("\n");

    const seasons = parseSeriesBody(body);

    expect(seasons).toHaveLength(2);
    expect(seasons[0].number).toBe(1);
    expect(seasons[0].episodes).toHaveLength(2);
    expect(seasons[0].episodes[0]).toMatchObject({ number: 1, title: "Refined Aggression", watched: true });
    expect(seasons[0].episodes[1]).toMatchObject({ number: 2, title: "Tackle Tommy Woo Woo", watched: false });
    expect(seasons[1].episodes[0]).toMatchObject({ number: 1, title: "The Road to Kingdom", watched: false });
  });

  it("ignores lines outside a season heading", () => {
    const body = "- [ ] E1 — orphan episode\n## Season 1\n- [ ] E1 — real episode";
    const seasons = parseSeriesBody(body);
    expect(seasons).toHaveLength(1);
    expect(seasons[0].episodes).toHaveLength(1);
    expect(seasons[0].episodes[0].title).toBe("real episode");
  });
});

describe("parseFrontmatter", () => {
  it("fills defaults for missing fields", () => {
    const fm = parseFrontmatter({ title: "The Gentlemen" });
    expect(fm).toMatchObject({
      title: "The Gentlemen",
      status: "want-to-watch",
      rating: null,
      image: "",
      source_url: "",
    });
  });
});

describe("extractImdbId", () => {
  it("extracts an IMDb id from a title URL", () => {
    expect(extractImdbId("https://www.imdb.com/title/tt13210838/")).toBe("tt13210838");
  });

  it("returns null for a non-IMDb url", () => {
    expect(extractImdbId("https://example.com")).toBeNull();
  });
});

describe("parseImdbId", () => {
  it("accepts a bare id", () => {
    expect(parseImdbId("tt1234567")).toBe("tt1234567");
  });

  it("extracts the id from a full URL", () => {
    expect(parseImdbId("https://www.imdb.com/title/tt1234567/")).toBe("tt1234567");
  });

  it("extracts the id from a URL with no trailing slash", () => {
    expect(parseImdbId("https://www.imdb.com/title/tt1234567")).toBe("tt1234567");
  });

  it("extracts the id from a URL with a query string", () => {
    expect(parseImdbId("https://www.imdb.com/title/tt1234567/?ref_=nv_sr_srsg_0")).toBe("tt1234567");
  });

  it("returns null when no tt-id is present", () => {
    expect(parseImdbId("not an id")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseImdbId("")).toBeNull();
  });
});

describe("normalizeFolderPath", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeFolderPath("Media/Series/")).toBe("Media/Series");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeFolderPath("Media/Series///")).toBe("Media/Series");
  });

  it("leaves a path with no trailing slash unchanged", () => {
    expect(normalizeFolderPath("Media/Series")).toBe("Media/Series");
  });
});

describe("splitFrontmatter", () => {
  it("splits frontmatter and body when frontmatter is present", () => {
    const content = ["---", "title: The Gentlemen", "type: series", "---", "## Season 1", "- [ ] E1 — Pilot"].join(
      "\n",
    );

    const { frontmatterBlock, body } = splitFrontmatter(content);

    expect(frontmatterBlock).toBe("---\ntitle: The Gentlemen\ntype: series\n---\n");
    expect(body).toBe("## Season 1\n- [ ] E1 — Pilot");
  });

  it("returns the whole content as body with an empty frontmatter block when there is no frontmatter", () => {
    const content = "## Season 1\n- [ ] E1 — Pilot";

    const { frontmatterBlock, body } = splitFrontmatter(content);

    expect(frontmatterBlock).toBe("");
    expect(body).toBe(content);
  });

  it("does not get confused by a '---' appearing inside the body", () => {
    const content = ["---", "title: X", "---", "Some note", "---", "more text"].join("\n");

    const { frontmatterBlock, body } = splitFrontmatter(content);

    expect(frontmatterBlock).toBe("---\ntitle: X\n---\n");
    expect(body).toBe("Some note\n---\nmore text");
  });
});

describe("setFrontmatterNumberField", () => {
  it("replaces an existing numeric field", () => {
    const fm = "---\ntitle: X\nrating: null\n---\n";
    expect(setFrontmatterNumberField(fm, "rating", 4)).toBe("---\ntitle: X\nrating: 4\n---\n");
  });

  it("inserts the field before the closing fence when absent", () => {
    const fm = "---\ntitle: X\n---\n";
    expect(setFrontmatterNumberField(fm, "rating", 5)).toBe("---\ntitle: X\nrating: 5\n---\n");
  });

  it("writes literal null when value is null", () => {
    const fm = "---\ntitle: X\nrating: 4\n---\n";
    expect(setFrontmatterNumberField(fm, "rating", null)).toBe("---\ntitle: X\nrating: null\n---\n");
  });
});

describe("setFrontmatterStringField", () => {
  it("replaces an existing string field", () => {
    const fm = "---\ntitle: X\nstatus: want-to-watch\n---\n";
    expect(setFrontmatterStringField(fm, "status", "watching")).toBe("---\ntitle: X\nstatus: watching\n---\n");
  });

  it("inserts the field before the closing fence when absent", () => {
    const fm = "---\ntitle: X\n---\n";
    expect(setFrontmatterStringField(fm, "status", "abandoned")).toBe("---\ntitle: X\nstatus: abandoned\n---\n");
  });
});

describe("getNotesSection / setNotesSection", () => {
  it("returns empty string when no Notes heading exists", () => {
    expect(getNotesSection("## Season 1\n- [ ] E1 — Pilot")).toBe("");
  });

  it("extracts text under a Notes heading", () => {
    const body = "## Season 1\n- [ ] E1 — Pilot\n\n## Notes\nGreat pilot episode.\n";
    expect(getNotesSection(body)).toBe("Great pilot episode.");
  });

  it("stops at the next heading after Notes", () => {
    const body = "## Notes\nSome thoughts.\n\n## Season 1\n- [ ] E1 — Pilot";
    expect(getNotesSection(body)).toBe("Some thoughts.");
  });

  it("appends a new Notes section when none exists", () => {
    const body = "## Season 1\n- [ ] E1 — Pilot";
    const result = setNotesSection(body, "Looking forward to this.");
    expect(result).toBe("## Season 1\n- [ ] E1 — Pilot\n\n## Notes\nLooking forward to this.\n");
  });

  it("replaces an existing Notes section without touching the rest", () => {
    const body = "## Notes\nOld note.\n\n## Season 1\n- [ ] E1 — Pilot";
    const result = setNotesSection(body, "New note.");
    expect(result).toBe("## Notes\nNew note.\n\n## Season 1\n- [ ] E1 — Pilot");
  });
});

describe("toggleEpisodeLine", () => {
  it("checks an unchecked line", () => {
    const lines = ["- [ ] E1 — Pilot"];
    const result = toggleEpisodeLine(lines, 0, true);
    expect(result[0]).toBe("- [x] E1 — Pilot");
  });

  it("unchecks a checked line", () => {
    const lines = ["- [x] E1 — Pilot"];
    const result = toggleEpisodeLine(lines, 0, false);
    expect(result[0]).toBe("- [ ] E1 — Pilot");
  });

  it("stamps a watched date when checking with one provided", () => {
    const lines = ["- [ ] E1 — Pilot"];
    const result = toggleEpisodeLine(lines, 0, true, "2026-09-13");
    expect(result[0]).toBe("- [x] E1 — Pilot (watched: 2026-09-13)");
  });

  it("strips an existing watched date when unchecking", () => {
    const lines = ["- [x] E1 — Pilot (watched: 2026-09-13)"];
    const result = toggleEpisodeLine(lines, 0, false);
    expect(result[0]).toBe("- [ ] E1 — Pilot");
  });

  it("replaces an existing watched date with a new one", () => {
    const lines = ["- [x] E1 — Pilot (watched: 2026-09-01)"];
    const result = toggleEpisodeLine(lines, 0, true, "2026-09-13");
    expect(result[0]).toBe("- [x] E1 — Pilot (watched: 2026-09-13)");
  });
});

describe("mergeNewEpisodes", () => {
  it("appends new episodes to an existing season without touching existing lines", () => {
    const body = "## Season 1\n- [x] E1 — Pilot (watched: 2026-09-01)\n- [ ] E2 — Second\n";
    const result = mergeNewEpisodes(body, [
      { number: 1, episodes: [{ episode: 1, title: "Pilot" }, { episode: 2, title: "Second" }, { episode: 3, title: "Third" }] },
    ]);

    expect(result.episodesAdded).toBe(1);
    expect(result.seasonsAdded).toBe(0);
    expect(result.body).toBe(
      "## Season 1\n- [x] E1 — Pilot (watched: 2026-09-01)\n- [ ] E2 — Second\n- [ ] E3 — Third\n",
    );
  });

  it("appends a brand-new season block when the season doesn't exist yet", () => {
    const body = "## Season 1\n- [x] E1 — Pilot\n";
    const result = mergeNewEpisodes(body, [
      { number: 1, episodes: [{ episode: 1, title: "Pilot" }] },
      { number: 2, episodes: [{ episode: 1, title: "New Season Opener" }] },
    ]);

    expect(result.episodesAdded).toBe(1);
    expect(result.seasonsAdded).toBe(1);
    expect(result.body).toBe(
      "## Season 1\n- [x] E1 — Pilot\n\n## Season 2\n- [ ] E1 — New Season Opener\n",
    );
  });

  it("inserts a new season block before a Notes section rather than after it", () => {
    const body = "## Season 1\n- [x] E1 — Pilot\n\n## Notes\nSome thoughts.\n";
    const result = mergeNewEpisodes(body, [
      { number: 2, episodes: [{ episode: 1, title: "New Season Opener" }] },
    ]);

    expect(result.body).toBe(
      "## Season 1\n- [x] E1 — Pilot\n\n## Season 2\n- [ ] E1 — New Season Opener\n\n## Notes\nSome thoughts.\n",
    );
  });

  it("reports no changes when everything already exists", () => {
    const body = "## Season 1\n- [x] E1 — Pilot\n";
    const result = mergeNewEpisodes(body, [{ number: 1, episodes: [{ episode: 1, title: "Pilot" }] }]);

    expect(result.episodesAdded).toBe(0);
    expect(result.seasonsAdded).toBe(0);
    expect(result.body).toBe(body);
  });
});

describe("deriveStatus", () => {
  const airedByDefault = (_released: string | null) => true;
  const nothingAired = (_released: string | null) => false;

  it("returns want-to-watch when nothing has been watched", () => {
    expect(deriveStatus([{ watched: false, released: "2024-01-01" }], false, airedByDefault)).toBe("want-to-watch");
  });

  it("returns want-to-watch for a show with no episodes at all", () => {
    expect(deriveStatus([], false, airedByDefault)).toBe("want-to-watch");
  });

  it("returns watching when an aired episode is unwatched", () => {
    const episodes = [
      { watched: true, released: "2024-01-01" },
      { watched: false, released: "2024-01-08" },
    ];
    expect(deriveStatus(episodes, false, airedByDefault)).toBe("watching");
  });

  it("returns up-to-date when all aired episodes are watched but the show is still airing", () => {
    const episodes = [
      { watched: true, released: "2024-01-01" },
      { watched: false, released: "2099-01-01" }, // not aired yet
    ];
    const isAired = (released: string | null) => released === "2024-01-01";
    expect(deriveStatus(episodes, false, isAired)).toBe("up-to-date");
  });

  it("returns finished when all aired episodes are watched and the show has ended", () => {
    const episodes = [{ watched: true, released: "2024-01-01" }];
    expect(deriveStatus(episodes, true, airedByDefault)).toBe("finished");
  });

  it("returns watching (not up-to-date) when the aired set is empty, even with a watched episode", () => {
    // An empty aired set can't confirm "caught up" — deriveStatus
    // deliberately treats "no known aired episodes" as Pending rather than
    // vacuously Up to date, since allAiredWatched requires a non-empty
    // aired set to be true.
    const episodes = [{ watched: true, released: "2024-01-01" }];
    expect(deriveStatus(episodes, false, nothingAired)).toBe("watching");
  });
});

describe("stripWatchedDate", () => {
  it("returns the title unchanged when there is no date suffix", () => {
    expect(stripWatchedDate("Pilot")).toEqual({ title: "Pilot", watchedDate: null });
  });

  it("extracts a watched date suffix", () => {
    expect(stripWatchedDate("Pilot (watched: 2026-09-13)")).toEqual({
      title: "Pilot",
      watchedDate: "2026-09-13",
    });
  });
});
