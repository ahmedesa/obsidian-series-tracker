import { Plugin, WorkspaceLeaf } from "obsidian";
import { SeriesTrackerSettingTab } from "./SettingsTab";

export interface SeriesTrackerSettings {
  omdbApiKey: string;
  seriesFolder: string;
  omdbCache: Record<string, { fetchedAt: number; data: any }>;
}

export const DEFAULT_SETTINGS: SeriesTrackerSettings = {
  omdbApiKey: "",
  seriesFolder: "Media/Series",
  omdbCache: {},
};

export const VIEW_TYPE_DASHBOARD = "series-tracker-dashboard";

export default class SeriesTrackerPlugin extends Plugin {
  settings: SeriesTrackerSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("tv", "Open Series Tracker", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-series-tracker",
      name: "Open Series Tracker",
      callback: () => this.activateView(),
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
