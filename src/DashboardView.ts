import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseSeriesBody, parseFrontmatter, ParsedSeries } from "./SeriesParser";
import { renderShowDetail } from "./ShowDetailView";

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

export class DashboardView extends ItemView {
  plugin: SeriesTrackerPlugin;
  private currentFile: TFile | null = null;

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
    await this.render();
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
      const body = content.replace(/^---[\s\S]*?---\n?/, "");
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
    if (this.currentFile) {
      await this.renderDetail(this.currentFile);
    } else {
      await this.renderDashboard();
    }
  }

  async renderDashboard() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const all = await this.loadAllSeries();

    let totalEp = 0;
    let watchedEp = 0;
    let inProgress = 0;
    for (const { parsed } of all) {
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
    tile3.createDiv({ cls: "st-tile-value", text: `${all.length}` });
    tile3.createDiv({ cls: "st-tile-label", text: "Shows tracked" });

    const grid = container.createDiv({ cls: "st-grid" });
    for (const { file, parsed } of all) {
      const episodes = parsed.seasons.flatMap((s) => s.episodes);
      const watched = episodes.filter((e) => e.watched).length;
      const pct = episodes.length ? Math.round((100 * watched) / episodes.length) : 0;

      const card = grid.createDiv({ cls: "st-card" });
      if (parsed.frontmatter.image) {
        card.createEl("img", { attr: { src: parsed.frontmatter.image } });
      }
      card.createDiv({ cls: "st-card-title", text: parsed.frontmatter.title });
      card.createDiv({ cls: "st-card-progress", text: `${watched}/${episodes.length} (${pct}%)` });
      card.onClickEvent(() => {
        this.currentFile = file;
        this.render();
      });
    }
  }

  async renderDetail(file: TFile) {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");

    const back = container.createEl("button", { text: "← Back to dashboard" });
    back.onClickEvent(() => {
      this.currentFile = null;
      this.render();
    });

    await renderShowDetail(container, this.app, this.plugin, file, () => this.render());
  }

  async onClose() {}
}
