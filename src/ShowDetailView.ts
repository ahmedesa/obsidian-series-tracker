import { App, TFile, Notice, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import {
  parseSeriesBody,
  parseFrontmatter,
  extractImdbId,
  toggleEpisodeLine,
  splitFrontmatter,
  setFrontmatterNumberField,
  getNotesSection,
  setNotesSection,
} from "./SeriesParser";
import { OmdbClient, OmdbFetcher } from "./OmdbClient";

/** Routes OMDb requests through Obsidian's CORS-safe requestUrl API. */
const obsidianOmdbFetcher: OmdbFetcher = async (url) => {
  const res = await requestUrl({ url });
  return { json: res.json };
};

export async function renderShowDetail(
  container: Element,
  app: App,
  plugin: SeriesTrackerPlugin,
  file: TFile,
  onChange: () => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  try {
    const content = await app.vault.read(file);
    if (!isCurrent()) return;

    const { body } = splitFrontmatter(content);
    const cache = app.metadataCache.getFileCache(file);
    const fm = parseFrontmatter(cache?.frontmatter ?? {});
    const seasons = parseSeriesBody(body);

    container.createEl("h2", { text: fm.title });

    // Personal rating — 5 clickable stars, written back to the `rating`
    // frontmatter field (mirrors the Movies notes' rating convention).
    const ratingRow = container.createDiv({ cls: "st-rating-row" });
    ratingRow.createSpan({ text: "Your rating: " });
    const starButtons: HTMLButtonElement[] = [];
    const paintStars = (value: number | null) => {
      starButtons.forEach((btn, i) => {
        btn.textContent = value !== null && i < value ? "★" : "☆";
      });
    };
    for (let i = 1; i <= 5; i++) {
      const star = ratingRow.createEl("button", { cls: "st-star" });
      starButtons.push(star);
      star.addEventListener("click", async () => {
        const next = fm.rating === i ? null : i; // clicking the current rating clears it
        try {
          await app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            return setFrontmatterNumberField(live.frontmatterBlock, "rating", next) + live.body;
          });
          fm.rating = next;
          paintStars(next);
        } catch (err) {
          console.error("Series Tracker: failed to write rating", err);
          new Notice(`Series Tracker: failed to save rating — ${errorMessage(err)}`);
        }
      });
    }
    paintStars(fm.rating);

    const imdbId = extractImdbId(fm.source_url);
    const omdb = new OmdbClient(
      plugin.settings.omdbApiKey,
      plugin.settings.omdbCache,
      async (c) => {
        plugin.settings.omdbCache = c;
        await plugin.saveSettings();
      },
      obsidianOmdbFetcher,
    );

    // Series-level info panel (plot/rated/runtime/country/awards/rating) —
    // fetched and rendered before the episode lists, but never blocks them.
    if (imdbId) {
      const info = await omdb.getSeries(imdbId);
      if (!isCurrent()) return;
      if (info) {
        const panel = container.createDiv({ cls: "st-info-panel" });
        if (info.plot) panel.createEl("p", { cls: "st-info-plot", text: info.plot });
        const meta = panel.createDiv({ cls: "st-info-meta" });
        const fields: [string, string][] = [
          ["Rated", info.rated],
          ["Runtime", info.runtime],
          ["Country", info.country],
          ["IMDb rating", info.imdbRating],
          ["Awards", info.awards],
        ];
        for (const [label, value] of fields) {
          if (!value || value === "N/A") continue;
          const row = meta.createDiv({ cls: "st-info-row" });
          row.createEl("strong", { text: `${label}: ` });
          row.createSpan({ text: value });
        }
      }
    }

    // Render immediately from local data; OMDb air-date badges are patched
    // in once (parallel) fetches resolve, below.
    const rowsByKey: Record<string, HTMLElement> = {};

    for (const season of seasons) {
      const seasonHeader = container.createDiv({ cls: "st-season-header" });
      seasonHeader.createEl("h3", { text: `Season ${season.number}` });
      const markWatchedBtn = seasonHeader.createEl("button", {
        cls: "st-mark-watched",
        text: "Mark season as watched",
      });
      const list = container.createDiv({ cls: "st-episode-list" });
      const checkboxes: HTMLInputElement[] = [];

      for (const ep of season.episodes) {
        const row = list.createDiv({ cls: "st-episode-row" });
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = ep.watched;
        row.createSpan({ text: ` E${ep.number} — ${ep.title}` });
        rowsByKey[`${season.number}:${ep.number}`] = row;
        checkboxes.push(checkbox);

        checkbox.addEventListener("change", async () => {
          await writeEpisodeState(app, file, ep.lineIndex, checkbox.checked, checkbox, onChange);
        });
      }

      markWatchedBtn.addEventListener("click", async () => {
        markWatchedBtn.disabled = true;
        try {
          await app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            let lines = live.body.split("\n");
            for (const ep of season.episodes) {
              lines = toggleEpisodeLine(lines, ep.lineIndex, true);
            }
            return live.frontmatterBlock + lines.join("\n");
          });
          for (const cb of checkboxes) cb.checked = true;
          onChange();
        } catch (err) {
          console.error("Series Tracker: failed to mark season watched", err);
          new Notice(`Series Tracker: failed to mark season watched — ${errorMessage(err)}`);
        } finally {
          markWatchedBtn.disabled = false;
        }
      });
    }

    // Freeform notes, stored under a `## Notes` heading in the body.
    const notesSection = container.createDiv({ cls: "st-notes-section" });
    notesSection.createEl("h3", { text: "Notes" });
    const notesArea = notesSection.createEl("textarea", { cls: "st-notes-textarea" });
    notesArea.value = getNotesSection(body);
    let notesSaveTimer: number | undefined;
    notesArea.addEventListener("input", () => {
      window.clearTimeout(notesSaveTimer);
      notesSaveTimer = window.setTimeout(async () => {
        try {
          await app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            return live.frontmatterBlock + setNotesSection(live.body, notesArea.value);
          });
        } catch (err) {
          console.error("Series Tracker: failed to save notes", err);
          new Notice(`Series Tracker: failed to save notes — ${errorMessage(err)}`);
        }
      }, 600);
    });

    if (!imdbId || seasons.length === 0) return;

    const seasonResults = await Promise.all(
      seasons.map(async (season) => {
        const data = await omdb.getSeason(imdbId, season.number);
        return { number: season.number, data };
      }),
    );

    if (!isCurrent()) return;

    for (const { number, data } of seasonResults) {
      if (!data) continue;
      const season = seasons.find((s) => s.number === number);
      if (!season) continue;
      for (const ep of season.episodes) {
        const omdbEp = data.episodes.find((e) => e.episode === ep.number);
        if (!omdbEp || !omdbEp.released) continue;
        const released = new Date(omdbEp.released);
        const aired = !isNaN(released.getTime()) && released.getTime() <= Date.now();
        if (aired && !ep.watched) {
          const row = rowsByKey[`${number}:${ep.number}`];
          row?.createSpan({ cls: "st-badge-pending", text: " aired, unwatched" });
        }
      }
    }
  } catch (err) {
    console.error("Series Tracker: failed to render show detail", err);
    if (isCurrent()) {
      new Notice(`Series Tracker: failed to load show — ${errorMessage(err)}`);
    }
  }
}

async function writeEpisodeState(
  app: App,
  file: TFile,
  lineIndex: number,
  desired: boolean,
  checkbox: HTMLInputElement,
  onChange: () => void,
): Promise<void> {
  try {
    await app.vault.process(file, (data) => {
      const live = splitFrontmatter(data);
      const liveLines = live.body.split("\n");
      const newLines = toggleEpisodeLine(liveLines, lineIndex, desired);
      return live.frontmatterBlock + newLines.join("\n");
    });
    onChange();
  } catch (err) {
    checkbox.checked = !desired;
    console.error("Series Tracker: failed to write episode state", err);
    new Notice(`Series Tracker: failed to update episode — ${errorMessage(err)}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
