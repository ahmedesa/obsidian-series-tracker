import { Plugin, WorkspaceLeaf } from "obsidian";
import { SeriesTrackerSettingTab } from "./SettingsTab";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./DashboardView";
import { MoviesView, VIEW_TYPE_MOVIES } from "./MoviesView";
import { asString, extractImdbId, normalizeFolderPath } from "./SeriesParser";
import { CacheEntry } from "./TmdbClient";

export interface SeriesTrackerSettings {
  /**
   * Which MetadataProvider implementation to use. Only "tmdb" exists today —
   * this field exists so a future second provider is a Settings toggle, not
   * another rewrite across every view (see src/MetadataProvider.ts).
   */
  metadataProvider: string;
  tmdbApiKey: string;
  seriesFolder: string;
  moviesFolder: string;
  tmdbCache: Record<string, CacheEntry>;
  streamingCountry: string;
}

export const DEFAULT_SETTINGS: SeriesTrackerSettings = {
  metadataProvider: "tmdb",
  tmdbApiKey: "",
  seriesFolder: "Media/Series",
  moviesFolder: "Media/Movies",
  tmdbCache: {},
  streamingCountry: "US",
};

export default class SeriesTrackerPlugin extends Plugin {
  settings!: SeriesTrackerSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_MOVIES, (leaf) => new MoviesView(leaf, this));

    this.addRibbonIcon("tv", "Open Series Tracker", () => {
      void this.activateView();
    });
    this.addRibbonIcon("clapperboard", "Open Movie Tracker", () => {
      void this.activateMoviesView();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open series dashboard",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "open-movies",
      name: "Open movies dashboard",
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
    await workspace.revealLeaf(leaf);
  }

  async activateMoviesView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_MOVIES)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MOVIES, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /**
   * IMDb ids for every series/movie note currently in the vault, across
   * both configured folders. Series and movies share one TMDb cache
   * (settings.tmdbCache), so pruning it correctly requires knowing every
   * live id — not just the ones the calling view happens to track.
   */
  getAllLiveImdbIds(): Set<string> {
    const seriesFolder = normalizeFolderPath(this.settings.seriesFolder) + "/";
    const moviesFolder = normalizeFolderPath(this.settings.moviesFolder) + "/";
    const ids = new Set<string>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(seriesFolder) && !file.path.startsWith(moviesFolder)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (!fm || (fm.type !== "series" && fm.type !== "movie")) continue;
      const id = extractImdbId(asString(fm.source_url));
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
