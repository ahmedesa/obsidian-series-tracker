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
      .setName("OMDb API key")
      .setDesc("Used to fetch season episode lists and air dates. Leave blank to use local checkbox data only.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.omdbApiKey)
          .onChange(async (value) => {
            this.plugin.settings.omdbApiKey = value.trim();
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
  }
}
