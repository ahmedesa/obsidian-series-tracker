import { describe, it, expect } from "vitest";
import {
  parseMovieFrontmatter,
  movieStatusLabel,
  MOVIE_STATUS_OPTIONS,
  splitFrontmatter,
  setFrontmatterNumberField,
  setFrontmatterStringField,
  getNotesSection,
  setNotesSection,
  extractImdbId,
} from "../src/MovieParser";

describe("parseMovieFrontmatter", () => {
  it("fills defaults for missing fields", () => {
    const fm = parseMovieFrontmatter({ title: "About Fate 2022" });
    expect(fm).toMatchObject({
      title: "About Fate 2022",
      status: "want-to-watch",
      rating: null,
      favourite: false,
      image: "",
      source_url: "",
      genre: [],
      date_added: "",
      date_completed: "",
    });
  });

  it("parses a full vault-shaped movie frontmatter object", () => {
    const fm = parseMovieFrontmatter({
      type: "movie",
      title: "About Fate 2022",
      status: "watched",
      source: "notion-import",
      source_url: "",
      genre: ["Romance"],
      language: "",
      favourite: false,
      rating: 4,
      tags: ["Romance"],
      date_added: "2026-09-12",
      date_completed: "2025-09-20",
      image: "https://example.com/poster.jpg",
    });

    expect(fm).toMatchObject({
      title: "About Fate 2022",
      status: "watched",
      rating: 4,
      favourite: false,
      genre: ["Romance"],
      date_added: "2026-09-12",
      date_completed: "2025-09-20",
      image: "https://example.com/poster.jpg",
    });
  });

  it("treats non-boolean favourite values as false", () => {
    const fm = parseMovieFrontmatter({ favourite: "yes" });
    expect(fm.favourite).toBe(false);
  });

  it("treats non-array genre values as an empty array", () => {
    const fm = parseMovieFrontmatter({ genre: "Romance" });
    expect(fm.genre).toEqual([]);
  });
});

describe("MOVIE_STATUS_OPTIONS / movieStatusLabel", () => {
  it("has exactly the 3 movie statuses", () => {
    expect(MOVIE_STATUS_OPTIONS.map((o) => o.value)).toEqual(["want-to-watch", "watching", "watched"]);
  });

  it("labels a known status", () => {
    expect(movieStatusLabel("watched")).toBe("Watched");
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(movieStatusLabel("mystery")).toBe("mystery");
  });
});

describe("extractImdbId", () => {
  it("extracts an imdb id from a source_url", () => {
    expect(extractImdbId("https://www.imdb.com/title/tt1234567/")).toBe("tt1234567");
  });

  it("returns null when no imdb id is present", () => {
    expect(extractImdbId("")).toBeNull();
  });
});

describe("re-exported generic helpers", () => {
  it("splitFrontmatter separates frontmatter from body", () => {
    const content = '---\ntitle: "X"\n---\n\n# X\n';
    const { frontmatterBlock, body } = splitFrontmatter(content);
    expect(frontmatterBlock).toBe('---\ntitle: "X"\n---\n');
    expect(body).toBe("\n# X\n");
  });

  it("setFrontmatterNumberField replaces an existing numeric field", () => {
    const block = "---\nrating: null\n---\n";
    expect(setFrontmatterNumberField(block, "rating", 4)).toBe("---\nrating: 4\n---\n");
  });

  it("setFrontmatterStringField replaces an existing string field", () => {
    const block = "---\nstatus: want-to-watch\n---\n";
    expect(setFrontmatterStringField(block, "status", "watched")).toBe("---\nstatus: watched\n---\n");
  });

  it("getNotesSection/setNotesSection round-trip", () => {
    const body = "\n# X\n\n## Notes\nSome notes\n";
    expect(getNotesSection(body)).toBe("Some notes");
    expect(setNotesSection(body, "Updated notes")).toContain("Updated notes");
  });
});
