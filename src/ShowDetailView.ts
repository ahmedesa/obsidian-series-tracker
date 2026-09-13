import { App, TFile, Notice, requestUrl } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseSeriesBody, parseFrontmatter, extractImdbId, toggleEpisodeLine, splitFrontmatter } from "./SeriesParser";
import { OmdbClient, OmdbFetcher } from "./OmdbClient";

/** Routes OMDb requests through Obsidian's CORS-safe requestUrl API. */
const obsidianOmdbFetcher: OmdbFetcher = async (url) => {
  const res = await requestUrl({ url });
  return { json: res.json };
};

export async function renderShowDetail(
  container: Element,
  app: App,
  plugin: SeriesTrackerPlugin,
  file: TFile,
  onChange: () => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  try {
    const content = await app.vault.read(file);
    if (!isCurrent()) return;

    const { body } = splitFrontmatter(content);
    const cache = app.metadataCache.getFileCache(file);
    const fm = parseFrontmatter(cache?.frontmatter ?? {});
    const seasons = parseSeriesBody(body);

    container.createEl("h2", { text: fm.title });

    // Render immediately from local data; OMDb air-date badges are patched
    // in once (parallel) fetches resolve, below.
    const rowsByKey: Record<string, HTMLElement> = {};

    for (const season of seasons) {
      container.createEl("h3", { text: `Season ${season.number}` });
      const list = container.createDiv({ cls: "st-episode-list" });

      for (const ep of season.episodes) {
        const row = list.createDiv({ cls: "st-episode-row" });
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = ep.watched;
        row.createSpan({ text: ` E${ep.number} — ${ep.title}` });
        rowsByKey[`${season.number}:${ep.number}`] = row;

        checkbox.addEventListener("change", async () => {
          const desired = checkbox.checked;
          try {
            await app.vault.process(file, (data) => {
              const live = splitFrontmatter(data);
              const liveLines = live.body.split("\n");
              const newLines = toggleEpisodeLine(liveLines, ep.lineIndex, desired);
              return live.frontmatterBlock + newLines.join("\n");
            });
            onChange();
          } catch (err) {
            checkbox.checked = !desired;
            console.error("Series Tracker: failed to write episode state", err);
            new Notice(`Series Tracker: failed to update episode — ${errorMessage(err)}`);
          }
        });
      }
    }

    const imdbId = extractImdbId(fm.source_url);
    if (!imdbId || seasons.length === 0) return;

    const omdb = new OmdbClient(
      plugin.settings.omdbApiKey,
      plugin.settings.omdbCache,
      async (c) => {
        plugin.settings.omdbCache = c;
        await plugin.saveSettings();
      },
      obsidianOmdbFetcher,
    );

    const seasonResults = await Promise.all(
      seasons.map(async (season) => {
        const data = await omdb.getSeason(imdbId, season.number);
        return { number: season.number, data };
      }),
    );

    if (!isCurrent()) return;

    for (const { number, data } of seasonResults) {
      if (!data) continue;
      const season = seasons.find((s) => s.number === number);
      if (!season) continue;
      for (const ep of season.episodes) {
        const omdbEp = data.episodes.find((e) => e.episode === ep.number);
        if (!omdbEp || !omdbEp.released) continue;
        const released = new Date(omdbEp.released);
        const aired = !isNaN(released.getTime()) && released.getTime() <= Date.now();
        if (aired && !ep.watched) {
          const row = rowsByKey[`${number}:${ep.number}`];
          row?.createSpan({ cls: "st-badge-pending", text: " aired, unwatched" });
        }
      }
    }
  } catch (err) {
    console.error("Series Tracker: failed to render show detail", err);
    if (isCurrent()) {
      new Notice(`Series Tracker: failed to load show — ${errorMessage(err)}`);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
