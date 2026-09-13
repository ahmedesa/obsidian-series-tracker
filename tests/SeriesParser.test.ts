import { describe, it, expect } from "vitest";
import { parseSeriesBody, parseFrontmatter, extractImdbId, toggleEpisodeLine, splitFrontmatter } from "../src/SeriesParser";

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
});
