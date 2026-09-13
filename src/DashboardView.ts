import { ItemView, WorkspaceLeaf, TFile, Notice, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import {
  parseSeriesBody,
  parseFrontmatter,
  splitFrontmatter,
  extractImdbId,
  toggleEpisodeLine,
  normalizeFolderPath,
  ParsedSeries,
  STATUS_OPTIONS,
  statusLabel,
} from "./SeriesParser";
import { renderShowDetail } from "./ShowDetailView";
import { AddSeriesModal } from "./AddSeriesModal";
import { TmdbClient, TmdbFetcher, parseRuntimeMinutes } from "./TmdbClient";
import { todayIso } from "./dateUtil";
import { UpcomingEpisode, findNextUp, findUpcoming, groupUpcomingByDate } from "./upcoming";
import { findRecentlyWatched } from "./recentlyWatched";
import { pruneOmdbCache } from "./cachePrune";

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

/** Routes TMDb requests through Obsidian's CORS-safe requestUrl API. */
const obsidianTmdbFetcher: TmdbFetcher = async (url) => {
  const res = await requestUrl({ url });
  return { json: res.json };
};

export class DashboardView extends ItemView {
  plugin: SeriesTrackerPlugin;
  private currentFile: TFile | null = null;
  // Monotonically-incrementing counter so overlapping async renders can
  // detect they've been superseded and bail out before touching the DOM.
  private renderGeneration = 0;
  // Dashboard filter state — in-memory only, resets on view close.
  private filterText = "";
  private filterStatus: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SeriesTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText() {
    return "Series Tracker";
  }

  getIcon() {
    return "tv";
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
    const folder = normalizeFolderPath(this.plugin.settings.seriesFolder);
    return file.path.startsWith(folder + "/");
  }

  async loadAllSeries(): Promise<{ file: TFile; parsed: ParsedSeries }[]> {
    const folder = normalizeFolderPath(this.plugin.settings.seriesFolder);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") && !f.path.includes("/_bases/"));

    const results: { file: TFile; parsed: ParsedSeries }[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "series") continue;
      const content = await this.app.vault.read(file);
      const { body } = splitFrontmatter(content);
      results.push({
        file,
        parsed: {
          frontmatter: parseFrontmatter(fm),
          seasons: parseSeriesBody(body),
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
      console.error("Series Tracker: failed to render view", err);
      new Notice(`Series Tracker failed to render: ${errorMessage(err)}`);
    }
  }

  async renderDashboard(generation: number) {
    const all = await this.loadAllSeries();
    if (generation !== this.renderGeneration) return;

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const folder = normalizeFolderPath(this.plugin.settings.seriesFolder);
    const folderExists = await this.app.vault.adapter.exists(folder);
    if (generation !== this.renderGeneration) return;
    if (!folderExists) {
      container.createEl("p", {
        cls: "st-folder-missing",
        text: `Configured series folder "${folder}" doesn't exist. Check Settings → Series Tracker.`,
      });
      return;
    }

    // Fire-and-forget: drop TMDb cache entries for shows no longer tracked.
    // Never awaited/blocking — a stale cache entry costs nothing but disk
    // space, so this must not delay or race the render above it.
    void this.pruneCache();

    const header = container.createDiv({ cls: "st-dashboard-header" });

    // Free-text filter — matches on title, case-insensitive.
    const filterInput = header.createEl("input", {
      type: "text",
      cls: "st-filter-input",
      placeholder: "Filter shows…",
    });
    filterInput.value = this.filterText;
    filterInput.addEventListener("input", () => {
      this.filterText = filterInput.value;
      void this.render();
    });

    // Status filter — a button that opens a dropdown of the 5 statuses,
    // each showing how many tracked shows currently have it.
    const statusWrap = header.createDiv({ cls: "st-status-filter-wrap" });
    const statusBtn = statusWrap.createEl("button", {
      cls: "st-status-filter-btn",
      text: this.filterStatus ? `Status: ${statusLabel(this.filterStatus)} ✕` : "+ Status",
    });
    const statusMenu = statusWrap.createDiv({ cls: "st-status-menu" });
    let statusMenuOpen = false;
    statusMenu.hide();

    const counts: Record<string, number> = {};
    for (const { parsed } of all) {
      const s = parsed.frontmatter.status;
      counts[s] = (counts[s] ?? 0) + 1;
    }

    for (const opt of STATUS_OPTIONS) {
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

    const addBtn = header.createEl("button", { cls: "st-add-series", text: "+ Add series" });
    addBtn.addEventListener("click", () => {
      new AddSeriesModal(this.app, this.plugin, () => void this.render()).open();
    });

    // Placeholder now; populated once the async TMDb air-date fetch below
    // resolves. Reflects ALL tracked shows, independent of the filter/status
    // controls above (those only affect the grid).
    const nextUpContainer = container.createDiv({ cls: "st-nextup-container" });

    const filtered = all.filter(({ parsed }) => {
      if (this.filterStatus && parsed.frontmatter.status !== this.filterStatus) return false;
      if (this.filterText.trim() && !parsed.frontmatter.title.toLowerCase().includes(this.filterText.trim().toLowerCase())) {
        return false;
      }
      return true;
    });

    let totalEp = 0;
    let watchedEp = 0;
    let inProgress = 0;
    for (const { parsed } of filtered) {
      const episodes = parsed.seasons.flatMap((s) => s.episodes);
      const watched = episodes.filter((e) => e.watched).length;
      totalEp += episodes.length;
      watchedEp += watched;
      if (watched > 0 && watched < episodes.length) inProgress++;
    }

    const stats = container.createDiv({ cls: "st-stats" });
    const tile1 = stats.createDiv({ cls: "st-tile" });
    tile1.createDiv({ cls: "st-tile-value", text: `${watchedEp}/${totalEp}` });
    tile1.createDiv({ cls: "st-tile-label", text: "Episodes watched" });

    const tile2 = stats.createDiv({ cls: "st-tile" });
    tile2.createDiv({ cls: "st-tile-value", text: `${inProgress}` });
    tile2.createDiv({ cls: "st-tile-label", text: "Shows in progress" });

    const tile3 = stats.createDiv({ cls: "st-tile" });
    tile3.createDiv({ cls: "st-tile-value", text: `${filtered.length}` });
    tile3.createDiv({ cls: "st-tile-label", text: this.filterStatus || this.filterText ? "Shows matching" : "Shows tracked" });

    // Placeholder now; populated once loadTimeSpent (below) resolves — it
    // needs a per-show TMDb runtime lookup, so it can't be computed here
    // synchronously without blocking the rest of the dashboard.
    const tile4 = stats.createDiv({ cls: "st-tile" });
    const tile4Value = tile4.createDiv({ cls: "st-tile-value", text: "—" });
    tile4.createDiv({ cls: "st-tile-label", text: "Time spent watching" });

    const grid = container.createDiv({ cls: "st-grid" });
    for (const { file, parsed } of filtered) {
      const episodes = parsed.seasons.flatMap((s) => s.episodes);
      const watched = episodes.filter((e) => e.watched).length;
      const pct = episodes.length ? Math.round((100 * watched) / episodes.length) : 0;

      const card = grid.createDiv({ cls: "st-card" });
      if (parsed.frontmatter.image) {
        card.createEl("img", { attr: { src: parsed.frontmatter.image } });
      }
      card.createDiv({ cls: "st-card-title", text: parsed.frontmatter.title });
      card.createDiv({ cls: "st-card-status", text: statusLabel(parsed.frontmatter.status) });
      card.createDiv({ cls: "st-card-progress", text: `${watched}/${episodes.length} (${pct}%)` });
      card.onClickEvent(() => {
        this.currentFile = file;
        void this.render();
      });
    }

    if (all.length === 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No series tracked yet — click + Add series to get started." });
    } else if (filtered.length === 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No shows match the current filter." });
    }

    const upcomingContainer = container.createDiv({ cls: "st-upcoming-container" });

    // Recently watched — pure local data (watchedDate is already parsed
    // into each episode), so this renders immediately, no fetch needed.
    const recentlyWatchedContainer = container.createDiv({ cls: "st-recently-watched-container" });
    this.renderRecentlyWatched(
      recentlyWatchedContainer,
      all.map(({ parsed }) => ({
        title: parsed.frontmatter.title,
        image: parsed.frontmatter.image,
        seasons: parsed.seasons,
      })),
    );

    // Fetch air-date data for every unwatched episode across ALL tracked
    // shows (cached, so repeat opens are cheap) and populate the Next Up
    // spotlight + Upcoming list once it resolves. Never blocks the rest of
    // the dashboard, which has already rendered above.
    const fileByPath = new Map(all.map(({ file }) => [file.path, file]));
    this.loadUpcomingCandidates(all)
      .then((candidates) => {
        if (generation !== this.renderGeneration) return;
        this.renderNextUp(nextUpContainer, candidates, fileByPath);
        this.renderUpcoming(upcomingContainer, candidates);
      })
      .catch((err) => {
        console.error("Series Tracker: failed to load upcoming episodes", err);
      });

    // Time spent watching — needs a per-show TMDb runtime lookup (cached,
    // same as everything else), so it's fetched separately and patched into
    // the placeholder tile once it resolves. Independent of the Next Up/
    // Upcoming fetch above so one slow show doesn't hold up the other.
    this.loadTimeSpentMinutes(all)
      .then((minutes) => {
        if (generation !== this.renderGeneration) return;
        tile4Value.setText(formatDurationMinutes(minutes));
      })
      .catch((err) => {
        console.error("Series Tracker: failed to compute time spent watching", err);
      });
  }

  /**
   * Drops TMDb cache entries for shows no longer tracked in the vault.
   * Fire-and-forget: never awaited by the caller, and only saves settings
   * when something was actually removed.
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

  /**
   * Sum of (watched episodes × the show's TMDb runtime-in-minutes) across
   * every tracked show with a resolvable IMDb id. Shows with no runtime
   * data (missing/unparsable) contribute 0, not an error.
   */
  private async loadTimeSpentMinutes(all: { file: TFile; parsed: ParsedSeries }[]): Promise<number> {
    const tmdb = new TmdbClient(
      this.plugin.settings.tmdbApiKey,
      this.plugin.settings.tmdbCache,
      async (c) => {
        this.plugin.settings.tmdbCache = c;
        await this.plugin.saveSettings();
      },
      obsidianTmdbFetcher,
    );

    const perShowMinutes = await Promise.all(
      all.map(async ({ parsed }) => {
        const watched = parsed.seasons.flatMap((s) => s.episodes).filter((e) => e.watched).length;
        if (watched === 0) return 0;
        const imdbId = extractImdbId(parsed.frontmatter.source_url);
        if (!imdbId) return 0;
        const info = await tmdb.getDetailsByImdbId(imdbId);
        return watched * parseRuntimeMinutes(info?.runtime);
      }),
    );

    return perShowMinutes.reduce((sum, m) => sum + m, 0);
  }

  private renderRecentlyWatched(
    container: HTMLElement,
    shows: { title: string; image: string; seasons: ParsedSeries["seasons"] }[],
  ): void {
    container.empty();
    const recent = findRecentlyWatched(shows);
    if (recent.length === 0) return;

    container.createEl("h3", { text: "Recently watched" });
    for (const entry of recent) {
      const row = container.createDiv({ cls: "st-recently-watched-row" });
      if (entry.showImage) {
        row.createEl("img", { cls: "st-recently-watched-thumb", attr: { src: entry.showImage } });
      }
      const epNum = `S${entry.season}E${String(entry.episode).padStart(2, "0")}`;
      const info = row.createDiv({ cls: "st-recently-watched-info" });
      info.createSpan({ cls: "st-recently-watched-show", text: entry.showTitle });
      info.createSpan({ cls: "st-recently-watched-episode", text: ` ${epNum} — ${entry.title}` });
      row.createSpan({ cls: "st-recently-watched-date", text: entry.watchedDate });
    }
  }

  /**
   * Fetches TMDb season data (respecting the normal 24h cache) for every
   * season that still has an unwatched episode, across every tracked show
   * with a resolvable IMDb id. Returns one UpcomingEpisode per unwatched
   * episode that TMDb has a release date for.
   */
  private async loadUpcomingCandidates(
    all: { file: TFile; parsed: ParsedSeries }[],
  ): Promise<UpcomingEpisode[]> {
    const tmdb = new TmdbClient(
      this.plugin.settings.tmdbApiKey,
      this.plugin.settings.tmdbCache,
      async (c) => {
        this.plugin.settings.tmdbCache = c;
        await this.plugin.saveSettings();
      },
      obsidianTmdbFetcher,
    );

    const candidates: UpcomingEpisode[] = [];

    for (const { file, parsed } of all) {
      const imdbId = extractImdbId(parsed.frontmatter.source_url);
      if (!imdbId) continue;

      for (const season of parsed.seasons) {
        const unwatched = season.episodes.filter((e) => !e.watched);
        if (unwatched.length === 0) continue;

        const data = await tmdb.getSeasonByImdbId(imdbId, season.number);
        if (!data) continue;

        for (const ep of unwatched) {
          const tmdbEp = data.episodes.find((e) => e.episode === ep.number);
          if (!tmdbEp || !tmdbEp.released || tmdbEp.released === "N/A") continue;
          candidates.push({
            showTitle: parsed.frontmatter.title,
            showImage: parsed.frontmatter.image,
            filePath: file.path,
            season: season.number,
            episode: ep.number,
            title: tmdbEp.title,
            released: tmdbEp.released,
            lineIndex: ep.lineIndex,
          });
        }
      }
    }

    return candidates;
  }

  private renderNextUp(
    container: HTMLElement,
    candidates: UpcomingEpisode[],
    fileByPath: Map<string, TFile>,
  ): void {
    container.empty();
    const nextUp = findNextUp(candidates);
    if (!nextUp) return;

    const card = container.createDiv({ cls: "st-nextup-card" });
    if (nextUp.showImage) {
      card.createEl("img", { cls: "st-nextup-poster", attr: { src: nextUp.showImage } });
    }
    const info = card.createDiv({ cls: "st-nextup-info" });
    info.createDiv({ cls: "st-nextup-show", text: nextUp.showTitle });
    const epNum = `S${nextUp.season}E${String(nextUp.episode).padStart(2, "0")}`;
    info.createDiv({ cls: "st-nextup-episode", text: `${epNum} — ${nextUp.title}` });
    info.createDiv({ cls: "st-nextup-date", text: nextUp.released });

    const markBtn = info.createEl("button", { cls: "st-nextup-mark", text: "Mark as watched" });
    const handleMarkWatched = async () => {
      const file = fileByPath.get(nextUp.filePath);
      if (!file) return;
      markBtn.disabled = true;
      try {
        const stamp = todayIso();
        await this.app.vault.process(file, (data) => {
          const live = splitFrontmatter(data);
          const lines = toggleEpisodeLine(live.body.split("\n"), nextUp.lineIndex, true, stamp);
          return live.frontmatterBlock + lines.join("\n");
        });
        await this.render();
      } catch (err) {
        markBtn.disabled = false;
        console.error("Series Tracker: failed to mark episode watched", err);
        new Notice(`Series Tracker: failed to update episode — ${errorMessage(err)}`);
      }
    };
    markBtn.addEventListener("click", () => void handleMarkWatched());
  }

  private renderUpcoming(container: HTMLElement, candidates: UpcomingEpisode[]): void {
    container.empty();
    const upcoming = findUpcoming(candidates);
    if (upcoming.length === 0) return;

    container.createEl("h3", { text: "Upcoming" });
    for (const group of groupUpcomingByDate(upcoming)) {
      container.createEl("h4", { cls: "st-upcoming-date-heading", text: group.dateLabel });
      for (const ep of group.episodes) {
        const row = container.createDiv({ cls: "st-upcoming-row" });
        if (ep.showImage) {
          row.createEl("img", { cls: "st-upcoming-thumb", attr: { src: ep.showImage } });
        }
        const epNum = `S${ep.season}E${String(ep.episode).padStart(2, "0")}`;
        row.createSpan({ cls: "st-upcoming-show", text: ep.showTitle });
        row.createSpan({ cls: "st-upcoming-episode", text: ` ${epNum} — ${ep.title}` });
      }
    }
  }

  async renderDetail(file: TFile, generation: number) {
    if (generation !== this.renderGeneration) return;

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const back = container.createEl("button", { text: "← Back to dashboard" });
    back.onClickEvent(() => {
      this.currentFile = null;
      void this.render();
    });

    await renderShowDetail(
      container,
      this.app,
      this.plugin,
      file,
      () => void this.render(),
      () => generation === this.renderGeneration,
      () => {
        this.currentFile = null;
        void this.render();
      },
    );
  }

  async onClose() {}
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** e.g. 90 -> "1h 30m", 1500 -> "1d 1h", 45 -> "45m". */
function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0m";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
