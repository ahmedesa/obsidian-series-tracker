import { ItemView, WorkspaceLeaf } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseFrontmatter, parseSeriesBody, splitFrontmatter, normalizeFolderPath, extractImdbId } from "./SeriesParser";
import { parseMovieFrontmatter } from "./MovieParser";
import { createMetadataProvider } from "./MetadataProvider";
import { parseRuntimeMinutes } from "./TmdbClient";
import { formatDurationMinutes } from "./dateUtil";
import { countGenres, computeTasteIndex, GenreCount, GenreTaste } from "./metrics";

export const VIEW_TYPE_METRICS = "series-tracker-metrics";

interface TrackedItem {
  kind: "series" | "movie";
  genres: string[];
  myRating: number | null;
  imdbId: string | null;
  /** Series: count of watched episodes. Movies: 1 if watched, else 0. */
  watchedUnits: number;
}

/**
 * Read-only combined-stats view across both series and movies — top
 * genres, total viewing time, and a "taste index" comparing the user's own
 * ratings against TMDb's public rating, per genre. No editing here.
 */
export class MetricsView extends ItemView {
  plugin: SeriesTrackerPlugin;
  private renderGeneration = 0;

  constructor(leaf: WorkspaceLeaf, plugin: SeriesTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_METRICS;
  }

  getDisplayText() {
    return "Series Tracker metrics";
  }

  getIcon() {
    return "bar-chart-3";
  }

  async onOpen() {
    await this.render();
  }

  /**
   * Series need a body read to count actually-watched episodes (matching
   * how the series dashboard's own "Time spent watching" tile works) —
   * status alone ("finished") doesn't say how many episodes that covers.
   * Movies are a single watched/not-watched flag, so frontmatter alone
   * (via metadataCache) is enough for them.
   */
  private async loadTrackedItems(): Promise<TrackedItem[]> {
    const seriesFolder = normalizeFolderPath(this.plugin.settings.seriesFolder) + "/";
    const moviesFolder = normalizeFolderPath(this.plugin.settings.moviesFolder) + "/";
    const items: TrackedItem[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (!fm) continue;

      if (fm.type === "series" && file.path.startsWith(seriesFolder)) {
        const parsed = parseFrontmatter(fm);
        const content = await this.app.vault.read(file);
        const { body } = splitFrontmatter(content);
        const watchedUnits = parseSeriesBody(body)
          .flatMap((s) => s.episodes)
          .filter((e) => e.watched).length;
        items.push({
          kind: "series",
          genres: parsed.tags,
          myRating: parsed.rating,
          imdbId: extractImdbId(parsed.source_url),
          watchedUnits,
        });
      } else if (fm.type === "movie" && file.path.startsWith(moviesFolder)) {
        const parsed = parseMovieFrontmatter(fm);
        items.push({
          kind: "movie",
          genres: parsed.genre,
          myRating: parsed.rating,
          imdbId: extractImdbId(parsed.source_url),
          watchedUnits: parsed.status === "watched" ? 1 : 0,
        });
      }
    }
    return items;
  }

  async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("series-tracker-view");
    container.createEl("h2", { text: "Series Tracker metrics" });

    const items = await this.loadTrackedItems();
    if (generation !== this.renderGeneration) return;
    if (items.length === 0) {
      container.createEl("p", {
        cls: "st-empty-state",
        text: "Nothing tracked yet — add a series or movie to see metrics.",
      });
      return;
    }

    // Top genres — cheap, purely local, renders immediately.
    const genreCounts = countGenres(items.map((i) => i.genres));
    this.renderGenreCounts(container, genreCounts);

    // Runtime + public-rating lookups need TMDb calls (cached), so total
    // viewing time and the taste index are computed async and patched in.
    const timeSection = container.createDiv({ cls: "st-metrics-section" });
    timeSection.createEl("h3", { text: "Total time watched" });
    const timeValue = timeSection.createDiv({ cls: "st-tile-value", text: "—" });

    const tasteSection = container.createDiv({ cls: "st-metrics-section" });
    tasteSection.createEl("h3", { text: "Your taste vs. TMDb" });
    const tasteContainer = tasteSection.createDiv();
    tasteContainer.createEl("p", { cls: "st-empty-state", text: "Loading…" });

    this.loadRuntimeAndTaste(items)
      .then(({ totalMinutes, taste }) => {
        if (generation !== this.renderGeneration) return;
        timeValue.setText(formatDurationMinutes(totalMinutes));
        this.renderTasteIndex(tasteContainer, taste);
      })
      .catch((err) => {
        console.error("Series Tracker: failed to compute metrics", err);
        if (generation === this.renderGeneration) {
          tasteContainer.empty();
          tasteContainer.createEl("p", { cls: "st-empty-state", text: "Couldn't load — check your TMDb API key." });
        }
      });
  }

  private renderGenreCounts(container: Element, genreCounts: GenreCount[]): void {
    const section = container.createDiv({ cls: "st-metrics-section" });
    section.createEl("h3", { text: "Top genres" });
    if (genreCounts.length === 0) {
      section.createEl("p", { cls: "st-empty-state", text: "No genre data yet." });
      return;
    }
    const max = genreCounts[0].count;
    for (const { genre, count } of genreCounts.slice(0, 10)) {
      const row = section.createDiv({ cls: "st-metrics-bar-row" });
      row.createSpan({ cls: "st-metrics-bar-label", text: genre });
      const track = row.createDiv({ cls: "st-metrics-bar-track" });
      const fill = track.createDiv({ cls: "st-metrics-bar-fill" });
      fill.style.width = `${Math.max(4, Math.round((100 * count) / max))}%`;
      row.createSpan({ cls: "st-metrics-bar-count", text: String(count) });
    }
  }

  private renderTasteIndex(container: HTMLElement, taste: GenreTaste[]): void {
    container.empty();
    if (taste.length === 0) {
      container.createEl("p", {
        cls: "st-empty-state",
        text: "Rate a few tracked shows/movies to see how your taste compares.",
      });
      return;
    }
    for (const { genre, myAvg, publicAvg, diff } of taste) {
      const row = container.createDiv({ cls: "st-metrics-taste-row" });
      row.createSpan({ cls: "st-metrics-bar-label", text: genre });
      row.createSpan({ text: `You: ${myAvg.toFixed(1)} · TMDb: ${publicAvg.toFixed(1)}` });
      row.createSpan({
        cls: diff >= 0 ? "st-metrics-taste-pos" : "st-metrics-taste-neg",
        text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`,
      });
    }
  }

  /**
   * One TMDb details lookup per item with a resolvable IMDb id (cached
   * 24h, same as every other lookup in this plugin) — gives both the
   * runtime (for total time watched) and TMDb's public rating (for the
   * taste index) from a single fetch per item.
   */
  private async loadRuntimeAndTaste(
    items: TrackedItem[],
  ): Promise<{ totalMinutes: number; taste: GenreTaste[] }> {
    const tmdb = createMetadataProvider(this.plugin.settings, async (c) => {
      this.plugin.settings.tmdbCache = c;
      await this.plugin.saveSettings();
    });

    let totalMinutes = 0;
    const tasteEntries: { genres: string[]; myRating: number | null; publicRating: number | null }[] = [];

    await Promise.all(
      items.map(async (item) => {
        if (!item.imdbId) return;
        const info = await tmdb.getDetailsByExternalId(item.imdbId);
        if (!info) return;
        totalMinutes += item.watchedUnits * parseRuntimeMinutes(info.runtime);
        const publicRating = info.imdbRating ? parseFloat(info.imdbRating) : null;
        tasteEntries.push({ genres: item.genres, myRating: item.myRating, publicRating });
      }),
    );

    return { totalMinutes, taste: computeTasteIndex(tasteEntries) };
  }

  async onClose() {}
}
