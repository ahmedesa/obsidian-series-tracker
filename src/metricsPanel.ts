import { App } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseFrontmatter, parseSeriesBody, splitFrontmatter, normalizeFolderPath, extractImdbId } from "./SeriesParser";
import { parseMovieFrontmatter } from "./MovieParser";
import { createMetadataProvider } from "./MetadataProvider";
import { parseRuntimeMinutes } from "./TmdbClient";
import { formatDurationMinutes } from "./dateUtil";
import { countGenres, computeTasteIndex, GenreCount, GenreTaste } from "./metrics";

interface TrackedItem {
  kind: "series" | "movie";
  genres: string[];
  myRating: number | null;
  imdbId: string | null;
  /** Series: count of watched episodes. Movies: 1 if watched, else 0. */
  watchedUnits: number;
}

/**
 * Series need a body read to count actually-watched episodes (matching how
 * the series dashboard's own "Time spent watching" tile works) — status
 * alone ("finished") doesn't say how many episodes that covers. Movies are
 * a single watched/not-watched flag, so frontmatter alone (via
 * metadataCache) is enough for them.
 */
async function loadTrackedItems(app: App, plugin: SeriesTrackerPlugin): Promise<TrackedItem[]> {
  const seriesFolder = normalizeFolderPath(plugin.settings.seriesFolder) + "/";
  const moviesFolder = normalizeFolderPath(plugin.settings.moviesFolder) + "/";
  const items: TrackedItem[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;

    if (fm.type === "series" && file.path.startsWith(seriesFolder)) {
      const parsed = parseFrontmatter(fm);
      const content = await app.vault.read(file);
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

/**
 * One metadata-provider details lookup per item with a resolvable IMDb id
 * (cached 24h, same as every other lookup in this plugin) — gives both the
 * runtime (for total time watched) and the provider's public rating (for
 * the taste index) from a single fetch per item.
 */
async function loadRuntimeAndTaste(
  app: App,
  plugin: SeriesTrackerPlugin,
  items: TrackedItem[],
): Promise<{ totalMinutes: number; taste: GenreTaste[] }> {
  const provider = createMetadataProvider(plugin.settings, async (c) => {
    plugin.settings.tmdbCache = c;
    await plugin.saveSettings();
  });

  let totalMinutes = 0;
  const tasteEntries: { genres: string[]; myRating: number | null; publicRating: number | null }[] = [];

  await Promise.all(
    items.map(async (item) => {
      if (!item.imdbId) return;
      const info = await provider.getDetailsByExternalId(item.imdbId);
      if (!info) return;
      totalMinutes += item.watchedUnits * parseRuntimeMinutes(info.runtime);
      const publicRating = info.imdbRating ? parseFloat(info.imdbRating) : null;
      tasteEntries.push({ genres: item.genres, myRating: item.myRating, publicRating });
    }),
  );

  return { totalMinutes, taste: computeTasteIndex(tasteEntries) };
}

function renderGenreCounts(container: HTMLElement, genreCounts: GenreCount[]): void {
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

function renderTasteIndex(container: HTMLElement, taste: GenreTaste[]): void {
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

async function loadAndRenderBody(
  body: HTMLElement,
  app: App,
  plugin: SeriesTrackerPlugin,
  isCurrent: () => boolean,
): Promise<void> {
  body.empty();
  body.createEl("p", { cls: "st-empty-state", text: "Loading…" });

  const items = await loadTrackedItems(app, plugin);
  if (!isCurrent()) return;
  body.empty();
  if (items.length === 0) {
    body.createEl("p", {
      cls: "st-empty-state",
      text: "Nothing tracked yet — add a series or movie to see metrics.",
    });
    return;
  }

  // Top genres — cheap, purely local, renders immediately.
  renderGenreCounts(body, countGenres(items.map((i) => i.genres)));

  // Runtime + public-rating lookups need provider calls (cached), so total
  // viewing time and the taste index are computed async and patched in.
  const timeSection = body.createDiv({ cls: "st-metrics-section" });
  timeSection.createEl("h3", { text: "Total time watched" });
  const timeValue = timeSection.createDiv({ cls: "st-tile-value", text: "—" });

  const tasteSection = body.createDiv({ cls: "st-metrics-section" });
  tasteSection.createEl("h3", { text: "Your taste vs. TMDb" });
  const tasteContainer = tasteSection.createDiv();
  tasteContainer.createEl("p", { cls: "st-empty-state", text: "Loading…" });

  loadRuntimeAndTaste(app, plugin, items)
    .then(({ totalMinutes, taste }) => {
      if (!isCurrent()) return;
      timeValue.setText(formatDurationMinutes(totalMinutes));
      renderTasteIndex(tasteContainer, taste);
    })
    .catch((err) => {
      console.error("Series Tracker: failed to compute metrics", err);
      if (isCurrent()) {
        tasteContainer.empty();
        tasteContainer.createEl("p", { cls: "st-empty-state", text: "Couldn't load — check your TMDb API key." });
      }
    });
}

/**
 * Collapsed-by-default "Metrics" panel — combined series+movies stats (top
 * genres, total viewing time, taste index). Shared by both the series and
 * movies dashboards so metrics stay one combined view rather than two
 * partial ones. Computation is lazy: nothing is fetched until the user
 * expands the panel, so it costs nothing on a dashboard render it's never
 * opened on.
 *
 * `isCurrent` should return false once the caller's render generation is
 * stale (the same guard pattern used elsewhere in this codebase), so a
 * slow fetch never patches a container that's since been repainted for
 * something else.
 */
export function renderMetricsPanel(
  container: Element,
  app: App,
  plugin: SeriesTrackerPlugin,
  isCurrent: () => boolean,
): void {
  const section = container.createDiv({ cls: "st-metrics-panel" });
  const toggleBtn = section.createEl("button", { cls: "st-metrics-toggle", text: "📊 Metrics ▾" });
  const body = section.createDiv({ cls: "st-metrics-body" });
  body.hide();

  let expanded = false;
  let loaded = false;

  toggleBtn.addEventListener("click", () => {
    expanded = !expanded;
    body.toggle(expanded);
    toggleBtn.setText(expanded ? "📊 Metrics ▴" : "📊 Metrics ▾");
    if (expanded && !loaded) {
      loaded = true;
      void loadAndRenderBody(body, app, plugin, isCurrent);
    }
  });
}
