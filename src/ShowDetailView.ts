import { App, TFile, Notice } from "obsidian";
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
  RATING_OPTIONS,
  MOOD_OPTIONS,
} from "./SeriesParser";
import { todayIso, isAired } from "./dateUtil";
import { createMetadataProvider, MetadataProvider } from "./MetadataProvider";
import { ConfirmModal } from "./ConfirmModal";

function newProvider(plugin: SeriesTrackerPlugin): MetadataProvider {
  return createMetadataProvider(plugin.settings, async (c) => {
    plugin.settings.tmdbCache = c;
    await plugin.saveSettings();
  });
}

export async function renderShowDetail(
  container: Element,
  app: App,
  plugin: SeriesTrackerPlugin,
  file: TFile,
  onChange: () => void,
  isCurrent: () => boolean = () => true,
  onDeleted: () => void = () => {},
): Promise<void> {
  try {
    const content = await app.vault.read(file);
    if (!isCurrent()) return;

    const { body } = splitFrontmatter(content);
    const cache = app.metadataCache.getFileCache(file);
    const fm = parseFrontmatter((cache?.frontmatter) ?? {});
    const seasons = parseSeriesBody(body);

    if (fm.backdrop) {
      container.createEl("img", { cls: "st-detail-backdrop", attr: { src: fm.backdrop } });
    }

    const titleRow = container.createDiv({ cls: "st-title-row" });
    titleRow.createEl("h2", { text: fm.title });
    const yearEl = titleRow.createSpan({ cls: "st-title-year" });

    const addedRow = container.createDiv({ cls: "st-completed-row" });
    addedRow.createSpan({ text: "Added: " });
    const addedInput = addedRow.createEl("input", { type: "date", cls: "st-completed-input" });
    addedInput.value = fm.date_added;
    const handleAddedChange = async () => {
      const next = addedInput.value;
      const previous = fm.date_added;
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return setFrontmatterStringField(live.frontmatterBlock, "date_added", next) + live.body;
        });
        fm.date_added = next;
      } catch (err) {
        addedInput.value = previous;
        console.error("Series Tracker: failed to write added date", err);
        new Notice(`Series Tracker: failed to save added date — ${errorMessage(err)}`);
      }
    };
    addedInput.addEventListener("change", () => void handleAddedChange());

    // Completed-on date — auto-stamped when status reaches "finished" (see
    // autoUpdateStatus below), but editable here so the user can correct or
    // backdate it.
    const completedRow = container.createDiv({ cls: "st-completed-row" });
    completedRow.createSpan({ text: "Completed on: " });
    const completedInput = completedRow.createEl("input", { type: "date", cls: "st-completed-input" });
    completedInput.value = fm.date_completed;
    const handleCompletedChange = async () => {
      const next = completedInput.value;
      const previous = fm.date_completed;
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return setFrontmatterStringField(live.frontmatterBlock, "date_completed", `"${next}"`) + live.body;
        });
        fm.date_completed = next;
      } catch (err) {
        completedInput.value = previous;
        console.error("Series Tracker: failed to write completed date", err);
        new Notice(`Series Tracker: failed to save completed date — ${errorMessage(err)}`);
      }
    };
    completedInput.addEventListener("change", () => void handleCompletedChange());

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
    const handleStatusChange = async () => {
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
    };
    statusSelect.addEventListener("change", () => void handleStatusChange());

    // Air-date lookups for auto-status, keyed "seasonNumber:episodeNumber".
    // Populated once the season fetches below resolve; `seriesEnded` comes
    // from the series-level TMDb lookup a little further down.
    const episodeAirDates = new Map<string, string>();
    let seriesEndedFlag: boolean | undefined;

    // Personal rating — dropdown 0-5 in 0.5 steps (plus "Unrated"), written
    // back to the `rating` frontmatter field (mirrors the Movies notes'
    // rating convention).
    const ratingRow = container.createDiv({ cls: "st-rating-row" });
    ratingRow.createSpan({ text: "Your rating: " });
    const ratingSelect = ratingRow.createEl("select", { cls: "st-rating-select" });
    ratingSelect.createEl("option", { value: "", text: "Unrated" });
    for (const r of RATING_OPTIONS) {
      ratingSelect.createEl("option", { value: String(r), text: String(r) });
    }
    ratingSelect.value = fm.rating !== null ? String(fm.rating) : "";
    const handleRatingChange = async () => {
      const next = ratingSelect.value === "" ? null : parseFloat(ratingSelect.value);
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
    };
    ratingSelect.addEventListener("change", () => void handleRatingChange());

    // Mood — a short curated "how did this make you feel" list, purely a
    // personal tag, no auto-management.
    const moodRow = container.createDiv({ cls: "st-mood-row" });
    moodRow.createSpan({ text: "Mood: " });
    const moodSelect = moodRow.createEl("select", { cls: "st-mood-select" });
    moodSelect.createEl("option", { value: "", text: "—" });
    for (const m of MOOD_OPTIONS) {
      moodSelect.createEl("option", { value: m, text: m });
    }
    moodSelect.value = fm.mood;
    const handleMoodChange = async () => {
      const next = moodSelect.value;
      const previous = fm.mood;
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return setFrontmatterStringField(live.frontmatterBlock, "mood", `"${next}"`) + live.body;
        });
        fm.mood = next;
      } catch (err) {
        moodSelect.value = previous;
        console.error("Series Tracker: failed to write mood", err);
        new Notice(`Series Tracker: failed to save mood — ${errorMessage(err)}`);
      }
    };
    moodSelect.addEventListener("change", () => void handleMoodChange());

    // Favourite toggle.
    const favRow = container.createDiv({ cls: "st-rating-row" });
    const favCheckbox = favRow.createEl("input", { type: "checkbox" });
    favCheckbox.checked = fm.favourite;
    favRow.createSpan({ text: " Favourite" });
    const handleFavouriteChange = async () => {
      const next = favCheckbox.checked;
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return setFrontmatterStringField(live.frontmatterBlock, "favourite", String(next)) + live.body;
        });
        fm.favourite = next;
      } catch (err) {
        favCheckbox.checked = !next;
        console.error("Series Tracker: failed to write favourite", err);
        new Notice(`Series Tracker: failed to save favourite — ${errorMessage(err)}`);
      }
    };
    favCheckbox.addEventListener("change", () => void handleFavouriteChange());

    const imdbId = extractImdbId(fm.source_url);

    // Refresh — force-refetch TMDb data (bypassing the 24h cache) and merge
    // any newly-aired seasons/episodes into the note. Existing checkbox
    // state and watched dates are never touched.
    const refreshBtn = container.createEl("button", { cls: "st-refresh-btn", text: "↻ refresh from TMDb" });
    const handleRefresh = async () => {
      // Re-derive from a fresh read rather than trusting the outer `fm`/
      // `imdbId` closures — those came from metadataCache.getFileCache() at
      // render time, which can lag behind the file's real current content
      // (e.g. right after a very recent create/write), producing a false
      // "no IMDb link" even when the note's actual frontmatter is correct.
      const liveContent = await app.vault.read(file);
      const { frontmatterBlock: liveFmBlock } = splitFrontmatter(liveContent);
      const liveSourceUrlMatch = liveFmBlock.match(/^source_url:\s*"?([^"\n]*)"?\s*$/m);
      const liveImdbId = extractImdbId(liveSourceUrlMatch?.[1] ?? "");

      if (!liveImdbId) {
        new Notice("Series tracker: this note has no IMDb link to refresh from.");
        return;
      }
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing…";
      try {
        const freshTmdb = newProvider(plugin);
        const freshInfo = await freshTmdb.getDetailsByExternalId(liveImdbId, true);
        const seasonCount = Math.min(freshInfo?.totalSeasons || seasons.length || 1, 25);

        const fetched = await Promise.all(
          Array.from({ length: seasonCount }, (_, i) => i + 1).map(async (n) => {
            const data = await freshTmdb.getSeasonByExternalId(liveImdbId, n, true);
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
          if (freshInfo?.network) {
            fmBlock = setFrontmatterStringField(fmBlock, "network", `"${freshInfo.network}"`);
          }
          if (freshInfo?.rated) {
            fmBlock = setFrontmatterStringField(fmBlock, "content_rating", `"${freshInfo.rated}"`);
          }
          if (freshInfo?.backdrop) {
            fmBlock = setFrontmatterStringField(fmBlock, "backdrop", `"${freshInfo.backdrop}"`);
          }
          return fmBlock + result.body;
        });

        if (merged.episodesAdded > 0) {
          const seasonNote = merged.seasonsAdded > 0 ? ` (${merged.seasonsAdded} new season${merged.seasonsAdded > 1 ? "s" : ""})` : "";
          new Notice(`Series Tracker: found ${merged.episodesAdded} new episode${merged.episodesAdded > 1 ? "s" : ""}${seasonNote}.`);
        } else {
          new Notice("Series tracker: no new episodes.");
        }
        onChange();
        await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag, completedInput);
      } catch (err) {
        console.error("Series Tracker: refresh failed", err);
        new Notice(`Series Tracker: refresh failed — ${errorMessage(err)}`);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "↻ refresh from TMDb";
      }
    };
    refreshBtn.addEventListener("click", () => void handleRefresh());

    const tmdb = newProvider(plugin);

    // Series-level info panel (plot/rated/runtime/country/awards/rating) —
    // fetched and rendered before the episode lists, but never blocks them.
    if (imdbId) {
      const info = await tmdb.getDetailsByExternalId(imdbId);
      if (!isCurrent()) return;
      seriesEndedFlag = info?.seriesEnded;
      if (info?.year) {
        yearEl.setText(`(${info.year})`);
      }
      if (info) {
        const panel = container.createDiv({ cls: "st-info-panel" });
        if (info.plot) panel.createEl("p", { cls: "st-info-plot", text: info.plot });
        const meta = panel.createDiv({ cls: "st-info-meta" });
        const fields: [string, string][] = [
          ["Airing status", info.seriesEnded ? "Ended" : "Returning"],
          ["Network", info.network],
          ["Rated", info.rated],
          ["Runtime", info.runtime],
          ["Country", info.country],
          ["TMDb rating", info.imdbRating],
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

    // Render immediately from local data; TMDb air-date badges are patched
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
      const dateInputs: HTMLInputElement[] = [];

      for (const ep of season.episodes) {
        const row = list.createDiv({ cls: "st-episode-row" });
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = ep.watched;
        row.createSpan({ text: ` E${ep.number} — ${ep.title}` });
        row.createSpan({ cls: "st-watched-date", text: " watched:" });
        // Editable watched-date — only meaningful (and only shown) once the
        // episode is checked. Unchecking clears it via the checkbox handler
        // below, not this input.
        const dateInput = row.createEl("input", { type: "date", cls: "st-episode-date-input" });
        dateInput.value = ep.watchedDate ?? "";
        if (!ep.watched) dateInput.hide();
        rowsByKey[`${season.number}:${ep.number}`] = row;
        checkboxes.push(checkbox);
        dateInputs.push(dateInput);

        const handleEpisodeToggle = async () => {
          const stamp = checkbox.checked ? todayIso() : null;
          await writeEpisodeState(app, file, ep.lineIndex, checkbox.checked, stamp, checkbox, onChange);
          ep.watchedDate = stamp;
          if (checkbox.checked && stamp) {
            dateInput.value = stamp;
            dateInput.show();
          } else {
            dateInput.value = "";
            dateInput.hide();
          }
          await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag, completedInput);
        };
        checkbox.addEventListener("change", () => void handleEpisodeToggle());

        const handleWatchedDateEdit = async () => {
          const next = dateInput.value;
          const previous = ep.watchedDate;
          if (!next) {
            dateInput.value = previous ?? "";
            return;
          }
          try {
            await app.vault.process(file, (data) => {
              const live = splitFrontmatter(data);
              const lines = toggleEpisodeLine(live.body.split("\n"), ep.lineIndex, true, next);
              return live.frontmatterBlock + lines.join("\n");
            });
            ep.watchedDate = next;
          } catch (err) {
            dateInput.value = previous ?? "";
            console.error("Series Tracker: failed to write episode watched date", err);
            new Notice(`Series Tracker: failed to update watched date — ${errorMessage(err)}`);
          }
        };
        dateInput.addEventListener("change", () => void handleWatchedDateEdit());
      }

      const handleMarkSeasonWatched = async () => {
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
          for (const di of dateInputs) {
            di.value = stamp;
            di.show();
          }
          season.episodes.forEach((ep) => {
            ep.watched = true;
            ep.watchedDate = stamp;
          });
          onChange();
          await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag, completedInput);
        } catch (err) {
          console.error("Series Tracker: failed to mark season watched", err);
          new Notice(`Series Tracker: failed to mark season watched — ${errorMessage(err)}`);
        } finally {
          markWatchedBtn.disabled = false;
        }
      };
      markWatchedBtn.addEventListener("click", () => void handleMarkSeasonWatched());
    }

    // Freeform notes, stored under a `## Notes` heading in the body.
    const notesSection = container.createDiv({ cls: "st-notes-section" });
    notesSection.createEl("h3", { text: "Notes" });
    const notesArea = notesSection.createEl("textarea", { cls: "st-notes-textarea" });
    notesArea.value = getNotesSection(body);
    let notesSaveTimer: number | undefined;
    const saveNotes = async () => {
      try {
        await app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          return live.frontmatterBlock + setNotesSection(live.body, notesArea.value);
        });
      } catch (err) {
        console.error("Series Tracker: failed to save notes", err);
        new Notice(`Series Tracker: failed to save notes — ${errorMessage(err)}`);
      }
    };
    notesArea.addEventListener("input", () => {
      window.clearTimeout(notesSaveTimer);
      notesSaveTimer = window.setTimeout(() => void saveNotes(), 600);
    });

    // Delete — the only way to remove a tracked show from the UI (previously
    // required deleting the note file directly in Obsidian). Moves the note
    // to Obsidian's trash (system/.trash per user settings), never a hard
    // filesystem delete, and only ever runs on an explicit confirmed click.
    const deleteSection = container.createDiv({ cls: "st-delete-section" });
    const deleteBtn = deleteSection.createEl("button", { cls: "st-delete-btn", text: "Delete show" });
    deleteBtn.addEventListener("click", () => {
      new ConfirmModal(
        app,
        "Delete show?",
        `This moves "${fm.title}" to Obsidian's trash. You can restore it from there if this was a mistake.`,
        "Delete",
        async () => {
          try {
            await app.fileManager.trashFile(file);
            new Notice(`Deleted "${fm.title}"`);
            onDeleted();
          } catch (err) {
            console.error("Series Tracker: failed to delete show", err);
            new Notice(`Series Tracker: failed to delete show — ${errorMessage(err)}`);
          }
        },
      ).open();
    });

    if (!imdbId || seasons.length === 0) return;

    const seasonResults = await Promise.all(
      seasons.map(async (season) => {
        const data = await tmdb.getSeasonByExternalId(imdbId, season.number);
        return { number: season.number, data };
      }),
    );

    if (!isCurrent()) return;

    for (const { number, data } of seasonResults) {
      if (!data) continue;
      const season = seasons.find((s) => s.number === number);
      if (!season) continue;
      for (const ep of season.episodes) {
        const tmdbEp = data.episodes.find((e) => e.episode === ep.number);
        if (!tmdbEp || !tmdbEp.released) continue;
        episodeAirDates.set(`${number}:${ep.number}`, tmdbEp.released);
        if (isAired(tmdbEp.released) && !ep.watched) {
          const row = rowsByKey[`${number}:${ep.number}`];
          row?.createSpan({ cls: "st-badge-pending", text: " aired, unwatched" });
        }
      }
    }

    // Now that air dates are known, get the status current for this open —
    // covers the case where TMDb data changed (e.g. a new episode aired)
    // since the last time this note was touched, without requiring an
    // explicit interaction first.
    await autoUpdateStatus(app, file, fm, statusSelect, episodeAirDates, seriesEndedFlag, completedInput);
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
  completedInput?: HTMLInputElement,
): Promise<void> {
  if (fm.status === MANUAL_ONLY_STATUS) return;

  try {
    let newStatus: string | null = null;
    let newCompletedDate: string | undefined;
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
      let fmBlock = setFrontmatterStringField(live.frontmatterBlock, "status", derived);
      // Mirror movies' auto-stamp-on-completion behavior: stamp today's date
      // when status reaches "finished", clear it when moving away from it.
      // The user can still edit this manually via the "Completed on" field.
      if (derived === "finished" && fm.status !== "finished") {
        newCompletedDate = todayIso();
        fmBlock = setFrontmatterStringField(fmBlock, "date_completed", `"${newCompletedDate}"`);
      } else if (derived !== "finished" && fm.status === "finished") {
        newCompletedDate = "";
        fmBlock = setFrontmatterStringField(fmBlock, "date_completed", `""`);
      }
      return fmBlock + live.body;
    });
    if (newStatus) {
      fm.status = newStatus;
      statusSelect.value = newStatus;
    }
    if (newCompletedDate !== undefined) {
      fm.date_completed = newCompletedDate;
      if (completedInput) completedInput.value = newCompletedDate;
    }
  } catch (err) {
    console.error("Series Tracker: failed to auto-update status", err);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
