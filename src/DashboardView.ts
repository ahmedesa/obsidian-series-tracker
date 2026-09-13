import { ItemView, WorkspaceLeaf, TFile, Notice, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import {
  parseSeriesBody,
  parseFrontmatter,
  splitFrontmatter,
  extractImdbId,
  toggleEpisodeLine,
  ParsedSeries,
  STATUS_OPTIONS,
  statusLabel,
} from "./SeriesParser";
import { renderShowDetail } from "./ShowDetailView";
import { AddSeriesModal } from "./AddSeriesModal";
import { OmdbClient, OmdbFetcher } from "./OmdbClient";
import { todayIso } from "./dateUtil";
import { UpcomingEpisode, findNextUp, findUpcoming, groupUpcomingByDate } from "./upcoming";

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

/** Routes OMDb requests through Obsidian's CORS-safe requestUrl API. */
const obsidianOmdbFetcher: OmdbFetcher = async (url) => {
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
          this.render();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && this.isRelevantFile(file)) {
          this.render();
        }
      }),
    );
    await this.render();
  }

  private isRelevantFile(file: TFile): boolean {
    if (this.currentFile) return file.path === this.currentFile.path;
    const folder = this.plugin.settings.seriesFolder;
    return file.path.startsWith(folder + "/");
  }

  async loadAllSeries(): Promise<{ file: TFile; parsed: ParsedSeries }[]> {
    const folder = this.plugin.settings.seriesFolder;
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
      this.render();
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
        this.render();
      });
    }
    statusBtn.addEventListener("click", () => {
      statusMenuOpen = !statusMenuOpen;
      statusMenu.toggle(statusMenuOpen);
    });

    const addBtn = header.createEl("button", { cls: "st-add-series", text: "+ Add series" });
    addBtn.addEventListener("click", () => {
      new AddSeriesModal(this.app, this.plugin, () => this.render()).open();
    });

    // Placeholder now; populated once the async OMDb air-date fetch below
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
        this.render();
      });
    }

    if (filtered.length === 0 && all.length > 0) {
      grid.createEl("p", { cls: "st-empty-state", text: "No shows match the current filter." });
    }

    const upcomingContainer = container.createDiv({ cls: "st-upcoming-container" });

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
  }

  /**
   * Fetches OMDb season data (respecting the normal 24h cache) for every
   * season that still has an unwatched episode, across every tracked show
   * with a resolvable IMDb id. Returns one UpcomingEpisode per unwatched
   * episode that OMDb has a release date for.
   */
  private async loadUpcomingCandidates(
    all: { file: TFile; parsed: ParsedSeries }[],
  ): Promise<UpcomingEpisode[]> {
    const omdb = new OmdbClient(
      this.plugin.settings.omdbApiKey,
      this.plugin.settings.omdbCache,
      async (c) => {
        this.plugin.settings.omdbCache = c;
        await this.plugin.saveSettings();
      },
      obsidianOmdbFetcher,
    );

    const candidates: UpcomingEpisode[] = [];

    for (const { file, parsed } of all) {
      const imdbId = extractImdbId(parsed.frontmatter.source_url);
      if (!imdbId) continue;

      for (const season of parsed.seasons) {
        const unwatched = season.episodes.filter((e) => !e.watched);
        if (unwatched.length === 0) continue;

        const data = await omdb.getSeason(imdbId, season.number);
        if (!data) continue;

        for (const ep of unwatched) {
          const omdbEp = data.episodes.find((e) => e.episode === ep.number);
          if (!omdbEp || !omdbEp.released || omdbEp.released === "N/A") continue;
          candidates.push({
            showTitle: parsed.frontmatter.title,
            showImage: parsed.frontmatter.image,
            filePath: file.path,
            season: season.number,
            episode: ep.number,
            title: omdbEp.title,
            released: omdbEp.released,
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
    markBtn.addEventListener("click", async () => {
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
        this.render();
      } catch (err) {
        markBtn.disabled = false;
        console.error("Series Tracker: failed to mark episode watched", err);
        new Notice(`Series Tracker: failed to update episode — ${errorMessage(err)}`);
      }
    });
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
      this.render();
    });

    await renderShowDetail(
      container,
      this.app,
      this.plugin,
      file,
      () => this.render(),
      () => generation === this.renderGeneration,
    );
  }

  async onClose() {}
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
