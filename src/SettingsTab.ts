import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type SeriesTrackerPlugin from "./main";

export class SeriesTrackerSettingTab extends PluginSettingTab {
  plugin: SeriesTrackerPlugin;

  constructor(app: App, plugin: SeriesTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings (Obsidian 1.13.0+) — makes these searchable in the
   * app-wide settings search. `display()` below stays as the fallback for
   * users below 1.13.0 (our minAppVersion is 1.7.2); Obsidian skips
   * `display()` automatically once this returns a non-empty array.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Metadata provider",
        desc: "Where series/movie search results and metadata come from. TMDb is currently the only supported provider.",
        control: {
          type: "dropdown",
          key: "metadataProvider",
          options: { tmdb: "TMDb" },
        },
      },
      {
        name: "TMDb API key",
        desc: "Used to fetch season episode lists, air dates, and search results (including non-English titles). Get a free key at themoviedb.org/settings/api. Leave blank to use local checkbox data only.",
        control: { type: "text", key: "tmdbApiKey" },
      },
      {
        name: "Series folder",
        desc: "Vault-relative folder containing your series notes.",
        control: { type: "text", key: "seriesFolder" },
      },
      {
        name: "Movies folder",
        desc: "Vault-relative folder containing your movie notes.",
        control: { type: "text", key: "moviesFolder" },
      },
      {
        name: "Streaming country",
        desc: "Country code for streaming availability, such as US, GB, or DE.",
        control: { type: "text", key: "streamingCountry" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    let normalized = value;
    if (typeof value === "string" && (key === "tmdbApiKey" || key === "seriesFolder" || key === "moviesFolder")) {
      normalized = value.trim();
    } else if (typeof value === "string" && key === "streamingCountry") {
      normalized = value.trim().toUpperCase() || "US";
    }
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = normalized;
    await this.plugin.saveSettings();
  }

  /** @deprecated Fallback for Obsidian < 1.13.0 — see getSettingDefinitions() above. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Metadata provider")
      .setDesc("Where series/movie search results and metadata come from. TMDb is currently the only supported provider.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("tmdb", "TMDb")
          .setValue(this.plugin.settings.metadataProvider)
          .onChange(async (value) => {
            this.plugin.settings.metadataProvider = value;
            await this.plugin.saveSettings();
          }),
      );

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
      .setDesc("Country code for streaming availability, such as US, GB, or DE.")
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
