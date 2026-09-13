import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseSeriesBody, parseFrontmatter, splitFrontmatter, ParsedSeries, STATUS_OPTIONS, statusLabel } from "./SeriesParser";
import { renderShowDetail } from "./ShowDetailView";
import { AddSeriesModal } from "./AddSeriesModal";

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

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
