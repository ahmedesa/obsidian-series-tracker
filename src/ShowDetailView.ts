import { App, TFile, Notice, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import {
  parseSeriesBody,
  parseFrontmatter,
  extractImdbId,
  toggleEpisodeLine,
  splitFrontmatter,
  setFrontmatterNumberField,
  setFrontmatterStringField,
  getNotesSection,
  setNotesSection,
  mergeNewEpisodes,
  deriveStatus,
  MANUAL_ONLY_STATUS,
  STATUS_OPTIONS,
  SeriesFrontmatter,
} from "./SeriesParser";
import { todayIso, isAired } from "./dateUtil";
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

    // Status — same 5 options as the dashboard's status filter. Wishlist/
    // Pending/Up to date/Completed are auto-managed (see autoUpdateStatus
    // below, called after every watch-state write); this dropdown is for
    // manually overriding — mainly to set Abandoned, which nothing else
    // ever touches once set.
    const statusRow = container.createDiv({ cls: "st-status-row" });
    statusRow.createSpan({ text: "Status: " });
    const statusSelect = statusRow.createEl("select", { cls: "st-status-select" });
    for (const opt of STATUS_OPTIONS) {
      statusSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    statusSelect.value = fm.status;
    statusRow.createSpan({
      cls: "st-status-hint",
      text: " (auto-managed unless set to Abandoned)",
    });
    statusSelect.addEventListener("change", async () => {
      const next = statusSelect.value;
      const previous = fm.status;
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return setFrontmatterStringField(live.frontmatterBlock, "status", next) + live.body;
        });
        fm.status = next;
      } catch (err) {
        statusSelect.value = previous;
        console.error("Series Tracker: failed to write status", err);
        new Notice(`Series Tracker: failed to save status — ${errorMessage(err)}`);
      }
    });

    // Air-date lookups for auto-status, keyed "seasonNumber:episodeNumber".
    // Populated once the season fetches below resolve; `seriesEnded` comes
    // from the series-level OMDb lookup a little further down.
    const episodeAirDates = new Map<string, string>();
    let seriesEndedFlag: boolean | undefined;

    // Personal rating — dropdown 0-5 (plus "Unrated"), written back to the
    // `rating` frontmatter field (mirrors the Movies notes' rating convention).
    const ratingRow = container.createDiv({ cls: "st-rating-row" });
    ratingRow.createSpan({ text: "Your rating: " });
    const ratingSelect = ratingRow.createEl("select", { cls: "st-rating-select" });
    ratingSelect.createEl("option", { value: "", text: "Unrated" });
    for (let i = 0; i <= 5; i++) {
      ratingSelect.createEl("option", { value: String(i), text: String(i) });
    }
    ratingSelect.value = fm.rating !== null ? String(fm.rating) : "";
    ratingSelect.addEventListener("change", async () => {
      const next = ratingSelect.value === "" ? null : parseInt(ratingSelect.value, 10);
      const previous = fm.rating;
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return setFrontmatterNumberField(live.frontmatterBlock, "rating", next) + live.body;
        });
        fm.rating = next;
      } catch (err) {
        ratingSelect.value = previous !== null ? String(previous) : "";
        console.error("Series Tracker: failed to write rating", err);
        new Notice(`Series Tracker: failed to save rating — ${errorMessage(err)}`);
      }
    });

    const imdbId = extractImdbId(fm.source_url);

    // Refresh — force-refetch OMDb data (bypassing the 24h cache) and merge
    // any newly-aired seasons/episodes into the note. Existing checkbox
    // state and watched dates are never touched.
    const refreshBtn = container.createEl("button", { cls: "st-refresh-btn", text: "↻ Refresh from OMDb" });
    refreshBtn.addEventListener("click", async () => {
      if (!imdbId) {
        new Notice("Series Tracker: this note has no IMDb link to refresh from.");
        return;
      }
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing…";
      try {
        const freshOmdb = new OmdbClient(
          plugin.settings.omdbApiKey,
          plugin.settings.omdbCache,
          async (c) => {
            plugin.settings.omdbCache = c;
            await plugin.saveSettings();
          },
          obsidianOmdbFetcher,
        );
        const freshInfo = await freshOmdb.getSeries(imdbId, true);
        const seasonCount = Math.min(freshInfo?.totalSeasons || seasons.length || 1, 25);

        const fetched = await Promise.all(
          Array.from({ length: seasonCount }, (_, i) => i + 1).map(async (n) => {
            const data = await freshOmdb.getSeason(imdbId, n, true);
            return data ? { number: n, data } : null;
          }),
        );
        const seasonsWithData = fetched.filter((s): s is { number: number; data: NonNullable<typeof fetched[number]>["data"] } => s !== null);
        const seasonsData = seasonsWithData.map((s) => ({
          number: s.number,
          episodes: s.data.episodes.map((e) => ({ episode: e.episode, title: e.title })),
        }));

        // Refresh the air-date map too, so the post-merge status recompute
        // below reflects any newly-discovered episodes' release dates.
        for (const { number, data } of seasonsWithData) {
          for (const ep of data.episodes) {
            if (ep.released) episodeAirDates.set(`${number}:${ep.episode}`, ep.released);
          }
        }
        seriesEndedFlag = freshInfo?.seriesEnded;

        let merged = { episodesAdded: 0, seasonsAdded: 0 };
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          const result = mergeNewEpisodes(live.body, seasonsData);
          merged = result;
          let fmBlock = live.frontmatterBlock;
          if (freshInfo?.totalSeasons) {
            fmBlock = setFrontmatterNumberField(fmBlock, "total_seasons", freshInfo.totalSeasons);
          }
          return fmBlock + result.body;
        });

        if (merged.episodesAdded > 0) {
          const seasonNote = merged.seasonsAdded > 0 ? ` (${merged.seasonsAdded} new season${merged.seasonsAdded > 1 ? "s" : ""})` : "";
          new Notice(`Series Tracker: found ${merged.episodesAdded} new episode${merged.episodesAdded > 1 ? "s" : ""}${seasonNote}.`);
        } else {
          new Notice("Series Tracker: no new episodes.");
        }
        onChange();
        await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag);
      } catch (err) {
        console.error("Series Tracker: refresh failed", err);
        new Notice(`Series Tracker: refresh failed — ${errorMessage(err)}`);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "↻ Refresh from OMDb";
      }
    });

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
      seriesEndedFlag = info?.seriesEnded;
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
        const dateSpan = row.createSpan({ cls: "st-watched-date" });
        if (ep.watchedDate) dateSpan.setText(` (watched ${ep.watchedDate})`);
        rowsByKey[`${season.number}:${ep.number}`] = row;
        checkboxes.push(checkbox);

        checkbox.addEventListener("change", async () => {
          const stamp = checkbox.checked ? todayIso() : null;
          await writeEpisodeState(app, file, ep.lineIndex, checkbox.checked, stamp, checkbox, onChange);
          dateSpan.setText(checkbox.checked && stamp ? ` (watched ${stamp})` : "");
          await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag);
        });
      }

      markWatchedBtn.addEventListener("click", async () => {
        markWatchedBtn.disabled = true;
        const stamp = todayIso();
        try {
          await app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            let lines = live.body.split("\n");
            for (const ep of season.episodes) {
              lines = toggleEpisodeLine(lines, ep.lineIndex, true, stamp);
            }
            return live.frontmatterBlock + lines.join("\n");
          });
          for (const cb of checkboxes) cb.checked = true;
          onChange();
          await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag);
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
        episodeAirDates.set(`${number}:${ep.number}`, omdbEp.released);
        if (isAired(omdbEp.released) && !ep.watched) {
          const row = rowsByKey[`${number}:${ep.number}`];
          row?.createSpan({ cls: "st-badge-pending", text: " aired, unwatched" });
        }
      }
    }

    // Now that air dates are known, get the status current for this open —
    // covers the case where OMDb data changed (e.g. a new episode aired)
    // since the last time this note was touched, without requiring an
    // explicit interaction first.
    await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag);
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
  watchedDate: string | null,
  checkbox: HTMLInputElement,
  onChange: () => void,
): Promise<void> {
  try {
    await app.vault.process(file, (data) => {
      const live = splitFrontmatter(data);
      const liveLines = live.body.split("\n");
      const newLines = toggleEpisodeLine(liveLines, lineIndex, desired, watchedDate);
      return live.frontmatterBlock + newLines.join("\n");
    });
    onChange();
  } catch (err) {
    checkbox.checked = !desired;
    console.error("Series Tracker: failed to write episode state", err);
    new Notice(`Series Tracker: failed to update episode — ${errorMessage(err)}`);
  }
}

/**
 * Recomputes the show's auto-managed status from current watch state and
 * writes it if it changed. Never overrides MANUAL_ONLY_STATUS ("abandoned")
 * — that's a deliberate user call nothing else should touch. Failures are
 * logged but non-fatal: this runs as a side-effect after other writes that
 * already succeeded, so it shouldn't surface as a user-facing error for
 * what is, from the user's perspective, a background sync.
 */
async function autoUpdateStatus(
  app: App,
  file: TFile,
  fm: SeriesFrontmatter,
  statusSelect: HTMLSelectElement,
  episodeAirDates: Map<string, string>,
  seriesEnded: boolean | undefined,
): Promise<void> {
  if (fm.status === MANUAL_ONLY_STATUS) return;

  try {
    let newStatus: string | null = null;
    await app.vault.process(file, (data) => {
      const live = splitFrontmatter(data);
      const liveSeasons = parseSeriesBody(live.body);
      const allEpisodes = liveSeasons.flatMap((s) =>
        s.episodes.map((e) => ({
          watched: e.watched,
          released: episodeAirDates.get(`${s.number}:${e.number}`) ?? null,
        })),
      );
      const derived = deriveStatus(allEpisodes, seriesEnded ?? false, (released) => isAired(released));
      if (derived === fm.status) return data;
      newStatus = derived;
      return setFrontmatterStringField(live.frontmatterBlock, "status", derived) + live.body;
    });
    if (newStatus) {
      fm.status = newStatus;
      statusSelect.value = newStatus;
    }
  } catch (err) {
    console.error("Series Tracker: failed to auto-update status", err);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
