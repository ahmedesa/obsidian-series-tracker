import { App, PluginSettingTab, Setting } from "obsidian";
import type SeriesTrackerPlugin from "./main";

export class SeriesTrackerSettingTab extends PluginSettingTab {
  plugin: SeriesTrackerPlugin;

  constructor(app: App, plugin: SeriesTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("TMDb API key")
      .setDesc(
        "Used to fetch season episode lists, air dates, and search results (including non-English titles). Get a free key at themoviedb.org/settings/api. Leave blank to use local checkbox data only.",
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.tmdbApiKey)
          .onChange(async (value) => {
            this.plugin.settings.tmdbApiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Series folder")
      .setDesc("Vault-relative folder containing your series notes.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.seriesFolder)
          .onChange(async (value) => {
            this.plugin.settings.seriesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Movies folder")
      .setDesc("Vault-relative folder containing your movie notes.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.moviesFolder)
          .onChange(async (value) => {
            this.plugin.settings.moviesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Streaming country")
      .setDesc("Country code for streaming availability (e.g. US, GB, DE).")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.streamingCountry)
          .onChange(async (value) => {
            this.plugin.settings.streamingCountry = value.trim().toUpperCase() || "US";
            await this.plugin.saveSettings();
          }),
      );
  }
}
