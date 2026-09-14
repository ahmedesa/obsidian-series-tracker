import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import {
  MovieFrontmatter,
  parseMovieFrontmatter,
  splitFrontmatter,
  setFrontmatterNumberField,
  setFrontmatterStringField,
  getNotesSection,
  setNotesSection,
  extractImdbId,
  normalizeFolderPath,
  MOVIE_STATUS_OPTIONS,
  movieStatusLabel,
  RATING_OPTIONS,
  extractDistinctGenres,
  MOOD_OPTIONS,
} from "./MovieParser";
import { AddMovieModal } from "./AddMovieModal";
import { createMetadataProvider, MetadataProvider, MetadataSearchResult } from "./MetadataProvider";
import { parseRuntimeMinutes } from "./TmdbClient";
import { todayIso, formatDurationMinutes } from "./dateUtil";
import { ConfirmModal } from "./ConfirmModal";
import { pruneOmdbCache } from "./cachePrune";
import { topRatedGenres, excludeTracked, normalizeTitle } from "./recommendations";
import { renderMetricsPanel } from "./metricsPanel";
import { SortBy, SORT_OPTIONS, DEFAULT_SORT_BY, sortEntries } from "./sorting";

export const VIEW_TYPE_MOVIES = "series-tracker-movies";

interface ParsedMovie {
  frontmatter: MovieFrontmatter;
  filePath: string;
}

export class MoviesView extends ItemView {
  plugin: SeriesTrackerPlugin;
  private currentFile: TFile | null = null;
  private renderGeneration = 0;
  private filterText = "";
  private filterStatus: string | null = null;
  private filterGenre: string | null = null;
  private sortBy: SortBy = DEFAULT_SORT_BY;
  private filterDebounceTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SeriesTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_MOVIES;
  }

  getDisplayText() {
    return "Movie tracker";
  }

  getIcon() {
    return "clapperboard";
  }

  async onOpen() {
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && this.isRelevantFile(file)) {
          void this.render();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && this.isRelevantFile(file)) {
          void this.render();
        }
      }),
    );
    await this.render();
  }

  private isRelevantFile(file: TFile): boolean {
    if (this.currentFile) return file.path === this.currentFile.path;
    const folder = normalizeFolderPath(this.plugin.settings.moviesFolder);
    return file.path.startsWith(folder + "/");
  }

  private newProvider(): MetadataProvider {
    return createMetadataProvider(this.plugin.settings, async (c) => {
      this.plugin.settings.tmdbCache = c;
      await this.plugin.saveSettings();
    });
  }

  async loadAllMovies(): Promise<{ file: TFile; parsed: ParsedMovie }[]> {
    const folder = normalizeFolderPath(this.plugin.settings.moviesFolder);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && !f.path.includes("/_bases/"));

    const results: { file: TFile; parsed: ParsedMovie }[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "movie") continue;
      results.push({
        file,
        parsed: {
          frontmatter: parseMovieFrontmatter(fm),
          filePath: file.path,
        },
      });
    }
    return results;
  }

  async render() {
    const generation = ++this.renderGeneration;
    try {
      if (this.currentFile) {
        await this.renderDetail(this.currentFile, generation);
      } else {
        await this.renderDashboard(generation);
      }
    } catch (err) {
      console.error("Series Tracker: failed to render movies view", err);
      new Notice(`Series Tracker failed to render: ${errorMessage(err)}`);
    }
  }

  async renderDashboard(generation: number) {
    const all = await this.loadAllMovies();
    if (generation !== this.renderGeneration) return;

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const folder = normalizeFolderPath(this.plugin.settings.moviesFolder);
    const folderExists = await this.app.vault.adapter.exists(folder);
    if (generation !== this.renderGeneration) return;
    if (!folderExists) {
      container.createEl("p", {
        cls: "st-folder-missing",
        text: `Configured movies folder "${folder}" doesn't exist. Check Settings → Series Tracker.`,
      });
      return;
    }

    // Fire-and-forget: drop TMDb cache entries for shows/movies no longer
    // tracked. Never awaited — must not delay or race the render below.
    void this.pruneCache();

    renderMetricsPanel(container, this.app, this.plugin, () => generation === this.renderGeneration);

    const header = container.createDiv({ cls: "st-dashboard-header" });

    const filterInput = header.createEl("input", {
      type: "text",
      cls: "st-filter-input",
      placeholder: "Filter movies…",
    });
    filterInput.value = this.filterText;
    filterInput.addEventListener("input", () => {
      this.filterText = filterInput.value;
      if (this.filterDebounceTimer !== null) window.clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = window.setTimeout(() => void this.render(), 300);
    });

    const statusWrap = header.createDiv({ cls: "st-status-filter-wrap" });
    const statusBtn = statusWrap.createEl("button", {
      cls: "st-status-filter-btn",
      text: this.filterStatus ? `Status: ${movieStatusLabel(this.filterStatus)} ✕` : "+ Status",
    });
    const statusMenu = statusWrap.createDiv({ cls: "st-status-menu" });
    let statusMenuOpen = false;
    statusMenu.hide();

    const counts: Record<string, number> = {};
    for (const { parsed } of all) {
      const s = parsed.frontmatter.status;
      counts[s] = (counts[s] ?? 0) + 1;
    }

    for (const opt of MOVIE_STATUS_OPTIONS) {
      const row = statusMenu.createDiv({ cls: "st-status-menu-row" });
      row.createSpan({ text: opt.label });
      row.createSpan({ cls: "st-status-menu-count", text: String(counts[opt.value] ?? 0) });
      row.addEventListener("click", () => {
        this.filterStatus = this.filterStatus === opt.value ? null : opt.value;
        void this.render();
      });
    }
    statusBtn.addEventListener("click", () => {
      statusMenuOpen = !statusMenuOpen;
      statusMenu.toggle(statusMenuOpen);
    });

    const genres = extractDistinctGenres(all.map(({ parsed }) => parsed.frontmatter.genre));
    const genreSelect = header.createEl("select", { cls: "st-genre-filter" });
    genreSelect.createEl("option", { value: "", text: "All genres" });
    for (const g of genres) {
      genreSelect.createEl("option", { value: g, text: g });
    }
    genreSelect.value = this.filterGenre ?? "";
    genreSelect.addEventListener("change", () => {
      this.filterGenre = genreSelect.value || null;
      void this.render();
    });

    // Sort control — the grid used to render in whatever arbitrary order
    // the vault returned files in, which users found confusing. "Last
    // edited" is the default (most-recently-touched note first).
    const sortSelect = header.createEl("select", { cls: "st-sort-select" });
    for (const opt of SORT_OPTIONS) {
      sortSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    sortSelect.value = this.sortBy;
    sortSelect.addEventListener("change", () => {
      this.sortBy = sortSelect.value as SortBy;
      void this.render();
    });

    const addBtn = header.createEl("button", { cls: "st-add-series", text: "+ add movie" });
    addBtn.addEventListener("click", () => {
      new AddMovieModal(this.app, this.plugin, () => void this.render()).open();
    });

    const filteredUnsorted = all.filter(({ parsed }) => {
      if (this.filterStatus && parsed.frontmatter.status !== this.filterStatus) return false;
      if (this.filterGenre && !parsed.frontmatter.genre.includes(this.filterGenre)) return false;
      if (this.filterText.trim() && !parsed.frontmatter.title.toLowerCase().includes(this.filterText.trim().toLowerCase())) {
        return false;
      }
      return true;
    });

    const filtered = sortEntries(
      filteredUnsorted.map((entry) => ({
        ...entry,
        title: entry.parsed.frontmatter.title,
        rating: entry.parsed.frontmatter.rating,
        status: entry.parsed.frontmatter.status,
        dateAdded: entry.parsed.frontmatter.date_added,
        dateCompleted: entry.parsed.frontmatter.date_completed,
        mtime: entry.file.stat.mtime,
      })),
      this.sortBy,
      MOVIE_STATUS_OPTIONS.map((o) => o.value),
    );

    const watchedCount = filtered.filter((m) => m.parsed.frontmatter.status === "watched").length;
    const favouriteCount = filtered.filter((m) => m.parsed.frontmatter.favourite).length;

    const stats = container.createDiv({ cls: "st-stats" });
    const tile1 = stats.createDiv({ cls: "st-tile" });
    tile1.createDiv({ cls: "st-tile-value", text: `${watchedCount}/${filtered.length}` });
    tile1.createDiv({ cls: "st-tile-label", text: "Movies watched" });

    const tile2 = stats.createDiv({ cls: "st-tile" });
    tile2.createDiv({ cls: "st-tile-value", text: `${favouriteCount}` });
    tile2.createDiv({ cls: "st-tile-label", text: "Favourites" });

    const tile3 = stats.createDiv({ cls: "st-tile" });
    tile3.createDiv({ cls: "st-tile-value", text: `${filtered.length}` });
    tile3.createDiv({
      cls: "st-tile-label",
      text: this.filterStatus || this.filterGenre || this.filterText ? "Movies matching" : "Movies tracked",
    });

    // Placeholder now; populated once loadTimeSpentMinutes (below) resolves
    // — needs a per-movie TMDb runtime lookup, same pattern as the series
    // dashboard's "Time spent watching" tile.
    const tile4 = stats.createDiv({ cls: "st-tile" });
    const tile4Value = tile4.createDiv({ cls: "st-tile-value", text: "—" });
    tile4.createDiv({ cls: "st-tile-label", text: "Time spent watching" });

    const providersTmdb = this.newProvider();

    const grid = container.createDiv({ cls: "st-grid" });
    for (const { file, parsed } of filtered) {
      const card = grid.createDiv({ cls: "st-card" });
      if (parsed.frontmatter.image) {
        card.createEl("img", { attr: { src: parsed.frontmatter.image } });
      }
      card.createDiv({ cls: "st-card-title", text: parsed.frontmatter.title + (parsed.frontmatter.favourite ? " ★" : "") });
      card.createDiv({ cls: "st-card-status", text: movieStatusLabel(parsed.frontmatter.status) });
      card.onClickEvent(() => {
        this.currentFile = file;
        void this.render();
      });

      // Streaming provider badges — patched in once the (cached) fetch
      // resolves, so a slow lookup never delays the card's own render.
      const imdbId = extractImdbId(parsed.frontmatter.source_url);
      if (imdbId) {
        const badges = card.createDiv({ cls: "st-card-providers" });
        providersTmdb
          .getWatchProvidersByExternalId(imdbId, this.plugin.settings.streamingCountry)
          .then((providers) => {
            if (generation !== this.renderGeneration) return;
            for (const p of providers.slice(0, 4)) {
              if (!p.logo) continue;
              badges.createEl("img", { cls: "st-provider-badge", attr: { src: p.logo, title: p.name } });
            }
          })
          .catch((err) => {
            console.error("Series Tracker: failed to load watch providers", err);
          });
      }
    }

    if (all.length === 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No movies tracked yet — click + add movie to get started." });
    } else if (filtered.length === 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No movies match the current filter." });
    }

    // Recommendations — based on the user's own rating history, so it's
    // fetched/rendered last and stays empty (no heading) until something
    // rated exists. Never blocks the rest of the dashboard.
    const recommendContainer = container.createDiv({ cls: "st-recommend-container" });
    this.loadRecommendations(all)
      .then((candidates) => {
        if (generation !== this.renderGeneration) return;
        this.renderRecommendations(recommendContainer, candidates);
      })
      .catch((err) => {
        console.error("Series Tracker: failed to load recommendations", err);
      });

    // Time spent watching — needs a per-movie TMDb runtime lookup (cached,
    // same as everything else), fetched separately so it never blocks the
    // rest of the dashboard, which has already rendered above.
    this.loadTimeSpentMinutes(filtered)
      .then((minutes) => {
        if (generation !== this.renderGeneration) return;
        tile4Value.setText(formatDurationMinutes(minutes));
      })
      .catch((err) => {
        console.error("Series Tracker: failed to compute time spent watching", err);
      });
  }

  /**
   * Sum of TMDb runtime-in-minutes across every tracked movie marked
   * "watched" with a resolvable IMDb id. Movies with no runtime data
   * (missing/unparsable) contribute 0, not an error.
   */
  private async loadTimeSpentMinutes(movies: { file: TFile; parsed: ParsedMovie }[]): Promise<number> {
    const tmdb = this.newProvider();

    const perMovieMinutes = await Promise.all(
      movies.map(async ({ parsed }) => {
        if (parsed.frontmatter.status !== "watched") return 0;
        const imdbId = extractImdbId(parsed.frontmatter.source_url);
        if (!imdbId) return 0;
        const info = await tmdb.getDetailsByExternalId(imdbId);
        return parseRuntimeMinutes(info?.runtime);
      }),
    );

    return perMovieMinutes.reduce((sum, m) => sum + m, 0);
  }

  /**
   * Popular unwatched titles in the user's top-rated genres (via TMDb
   * discover), excluding anything already tracked. Returns [] if nothing
   * is rated yet, or if genre names can't be mapped to TMDb ids.
   */
  private async loadRecommendations(all: { file: TFile; parsed: ParsedMovie }[]): Promise<MetadataSearchResult[]> {
    const topGenres = topRatedGenres(
      all.map(({ parsed }) => ({ genres: parsed.frontmatter.genre, rating: parsed.frontmatter.rating })),
    );
    if (topGenres.length === 0) return [];

    const tmdb = this.newProvider();

    const genreMap = await tmdb.getGenreMap("movie");
    const genreIds = topGenres.map((g) => genreMap[g]).filter((id): id is number => typeof id === "number");
    if (genreIds.length === 0) return [];

    const discovered = await tmdb.discover("movie", genreIds);
    const trackedTitles = new Set(all.map(({ parsed }) => normalizeTitle(parsed.frontmatter.title)));
    return excludeTracked(discovered, trackedTitles).slice(0, 8);
  }

  private renderRecommendations(container: HTMLElement, candidates: MetadataSearchResult[]): void {
    container.empty();
    if (candidates.length === 0) return;

    container.createEl("h3", { text: "Recommended for you" });
    const strip = container.createDiv({ cls: "st-recommend-strip" });
    for (const r of candidates) {
      const card = strip.createDiv({ cls: "st-recommend-card" });
      if (r.poster) card.createEl("img", { cls: "st-recommend-poster", attr: { src: r.poster } });
      card.createDiv({ cls: "st-recommend-title", text: `${r.title} (${r.year})` });
      if (r.rating) card.createDiv({ cls: "st-recommend-rating", text: `★ ${r.rating}` });
      const addBtn = card.createEl("button", { cls: "st-recommend-add", text: "+ add" });
      addBtn.addEventListener("click", () => {
        new AddMovieModal(this.app, this.plugin, () => void this.render(), r).open();
      });
    }
  }

  /**
   * Drops TMDb cache entries for shows/movies no longer tracked in the
   * vault. Fire-and-forget: only saves settings when something changed.
   */
  private async pruneCache(): Promise<void> {
    try {
      const liveImdbIds = this.plugin.getAllLiveImdbIds();
      const { pruned, removedCount } = pruneOmdbCache(this.plugin.settings.tmdbCache, liveImdbIds);
      if (removedCount === 0) return;
      this.plugin.settings.tmdbCache = pruned;
      await this.plugin.saveSettings();
    } catch (err) {
      console.error("Series Tracker: failed to prune TMDb cache", err);
    }
  }

  async renderDetail(file: TFile, generation: number) {
    if (generation !== this.renderGeneration) return;

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const back = container.createEl("button", { text: "← back to dashboard" });
    back.onClickEvent(() => {
      this.currentFile = null;
      void this.render();
    });

    await this.renderMovieDetail(
      container,
      file,
      () => void this.render(),
      () => generation === this.renderGeneration,
      () => {
        this.currentFile = null;
        void this.render();
      },
    );
  }

  private async renderMovieDetail(
    container: Element,
    file: TFile,
    onChange: () => void,
    isCurrent: () => boolean,
    onDeleted: () => void,
  ): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      if (!isCurrent()) return;

      const { body } = splitFrontmatter(content);
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = parseMovieFrontmatter((cache?.frontmatter) ?? {});

      if (fm.backdrop) {
        container.createEl("img", { cls: "st-detail-backdrop", attr: { src: fm.backdrop } });
      }

      const titleRow = container.createDiv({ cls: "st-title-row" });
      titleRow.createEl("h2", { text: fm.title });
      const yearEl = titleRow.createSpan({ cls: "st-title-year" });

      if (fm.image) {
        container.createEl("img", { cls: "st-detail-poster", attr: { src: fm.image } });
      }

      const addedRow = container.createDiv({ cls: "st-completed-row" });
      addedRow.createSpan({ text: "Added: " });
      const addedInput = addedRow.createEl("input", { type: "date", cls: "st-completed-input" });
      addedInput.value = fm.date_added;
      const handleAddedChange = async () => {
        const next = addedInput.value;
        const previous = fm.date_added;
        try {
          await this.app.vault.process(file, (data) => {
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

      // Completed-on date — auto-stamped when status becomes "watched" (see
      // handleStatusChange below), but editable here so the user can correct
      // or backdate it.
      const completedRow = container.createDiv({ cls: "st-completed-row" });
      completedRow.createSpan({ text: "Completed on: " });
      const completedInput = completedRow.createEl("input", { type: "date", cls: "st-completed-input" });
      completedInput.value = fm.date_completed;
      const handleCompletedChange = async () => {
        const next = completedInput.value;
        const previous = fm.date_completed;
        try {
          await this.app.vault.process(file, (data) => {
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

      // Status — 3-value picker. Stamps date_completed with today on
      // transition into "watched"; clears it on transition out.
      const statusRow = container.createDiv({ cls: "st-status-row" });
      statusRow.createSpan({ text: "Status: " });
      const statusSelect = statusRow.createEl("select", { cls: "st-status-select" });
      for (const opt of MOVIE_STATUS_OPTIONS) {
        statusSelect.createEl("option", { value: opt.value, text: opt.label });
      }
      statusSelect.value = fm.status;
      const handleStatusChange = async () => {
        const next = statusSelect.value;
        const previous = fm.status;
        try {
          let stampedDate: string | undefined;
          await this.app.vault.process(file, (data) => {
            const live = splitFrontmatter(data);
            let fmBlock = setFrontmatterStringField(live.frontmatterBlock, "status", next);
            if (next === "watched" && previous !== "watched") {
              stampedDate = todayIso();
              fmBlock = setFrontmatterStringField(fmBlock, "date_completed", `"${stampedDate}"`);
            } else if (next !== "watched" && previous === "watched") {
              stampedDate = "";
              fmBlock = setFrontmatterStringField(fmBlock, "date_completed", `""`);
            }
            return fmBlock + live.body;
          });
          fm.status = next;
          if (stampedDate !== undefined) {
            fm.date_completed = stampedDate;
            completedInput.value = stampedDate;
          }
        } catch (err) {
          statusSelect.value = previous;
          console.error("Series Tracker: failed to write status", err);
          new Notice(`Series Tracker: failed to save status — ${errorMessage(err)}`);
        }
      };
      statusSelect.addEventListener("change", () => void handleStatusChange());

      // Personal rating — dropdown 0-5 in 0.5 steps (plus "Unrated").
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
          await this.app.vault.process(file, (data) => {
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
          await this.app.vault.process(file, (data) => {
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
          await this.app.vault.process(file, (data) => {
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

      if (imdbId) {
        const tmdb = this.newProvider();
        const info = await tmdb.getDetailsByExternalId(imdbId);
        if (!isCurrent()) return;
        if (info?.year) {
          yearEl.setText(`(${info.year})`);
        }
        if (info) {
          const panel = container.createDiv({ cls: "st-info-panel" });
          if (info.plot) panel.createEl("p", { cls: "st-info-plot", text: info.plot });
          const meta = panel.createDiv({ cls: "st-info-meta" });
          const fields: [string, string][] = [
            ["Rated", info.rated],
            ["Runtime", info.runtime],
            ["Genre", info.genre],
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

      // Freeform notes, stored under a `## Notes` heading in the body.
      const notesSection = container.createDiv({ cls: "st-notes-section" });
      notesSection.createEl("h3", { text: "Notes" });
      const notesArea = notesSection.createEl("textarea", { cls: "st-notes-textarea" });
      notesArea.value = getNotesSection(body);
      let notesSaveTimer: number | undefined;
      const saveNotes = async () => {
        try {
          await this.app.vault.process(file, (data) => {
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

      // Delete — the only way to remove a tracked movie from the UI
      // (previously required deleting the note file directly in Obsidian).
      // Moves the note to Obsidian's trash, never a hard filesystem delete,
      // and only ever runs on an explicit confirmed click.
      const deleteSection = container.createDiv({ cls: "st-delete-section" });
      const deleteBtn = deleteSection.createEl("button", { cls: "st-delete-btn", text: "Delete movie" });
      deleteBtn.addEventListener("click", () => {
        new ConfirmModal(
          this.app,
          "Delete movie?",
          `This moves "${fm.title}" to Obsidian's trash. You can restore it from there if this was a mistake.`,
          "Delete",
          async () => {
            try {
              await this.app.fileManager.trashFile(file);
              new Notice(`Deleted "${fm.title}"`);
              onDeleted();
            } catch (err) {
              console.error("Series Tracker: failed to delete movie", err);
              new Notice(`Series Tracker: failed to delete movie — ${errorMessage(err)}`);
            }
          },
        ).open();
      });
    } catch (err) {
      console.error("Series Tracker: failed to render movie detail", err);
      if (isCurrent()) {
        new Notice(`Series Tracker: failed to load movie — ${errorMessage(err)}`);
      }
    }
  }

  async onClose() {}
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
