import { Plugin, WorkspaceLeaf } from "obsidian";
import { SeriesTrackerSettingTab } from "./SettingsTab";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./DashboardView";
import { MoviesView, VIEW_TYPE_MOVIES } from "./MoviesView";
import { extractImdbId, normalizeFolderPath } from "./SeriesParser";

export interface SeriesTrackerSettings {
  omdbApiKey: string;
  seriesFolder: string;
  moviesFolder: string;
  omdbCache: Record<string, { fetchedAt: number; data: any }>;
}

export const DEFAULT_SETTINGS: SeriesTrackerSettings = {
  omdbApiKey: "",
  seriesFolder: "Media/Series",
  moviesFolder: "Media/Movies",
  omdbCache: {},
};

export default class SeriesTrackerPlugin extends Plugin {
  settings!: SeriesTrackerSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_MOVIES, (leaf) => new MoviesView(leaf, this));

    this.addRibbonIcon("tv", "Open Series Tracker", () => {
      this.activateView();
    });
    this.addRibbonIcon("clapperboard", "Open Movie Tracker", () => {
      this.activateMoviesView();
    });

    this.addCommand({
      id: "open-series-tracker",
      name: "Open Series Tracker",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "open-movie-tracker",
      name: "Open Movie Tracker",
      callback: () => this.activateMoviesView(),
    });

    this.addSettingTab(new SeriesTrackerSettingTab(this.app, this));
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateMoviesView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_MOVIES)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MOVIES, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /**
   * IMDb ids for every series/movie note currently in the vault, across
   * both configured folders. Series and movies share one OMDb cache
   * (settings.omdbCache), so pruning it correctly requires knowing every
   * live id — not just the ones the calling view happens to track.
   */
  getAllLiveImdbIds(): Set<string> {
    const seriesFolder = normalizeFolderPath(this.settings.seriesFolder) + "/";
    const moviesFolder = normalizeFolderPath(this.settings.moviesFolder) + "/";
    const ids = new Set<string>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(seriesFolder) && !file.path.startsWith(moviesFolder)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || (fm.type !== "series" && fm.type !== "movie")) continue;
      const id = extractImdbId(fm.source_url ?? "");
      if (id) ids.add(id);
    }
    return ids;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
