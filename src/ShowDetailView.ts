import { App, TFile } from "obsidian";
import type SeriesTrackerPlugin from "./main";
import { parseSeriesBody, parseFrontmatter, extractImdbId, toggleEpisodeLine } from "./SeriesParser";
import { OmdbClient, OmdbSeasonResponse } from "./OmdbClient";

export async function renderShowDetail(
  container: Element,
  app: App,
  plugin: SeriesTrackerPlugin,
  file: TFile,
  onChange: () => void,
): Promise<void> {
  const content = await app.vault.read(file);
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const bodyLines = body.split("\n");

  const cache = app.metadataCache.getFileCache(file);
  const fm = parseFrontmatter(cache?.frontmatter ?? {});
  const seasons = parseSeriesBody(body);

  container.createEl("h2", { text: fm.title });

  const imdbId = extractImdbId(fm.source_url);
  const omdb = new OmdbClient(
    plugin.settings.omdbApiKey,
    plugin.settings.omdbCache,
    async (c) => {
      plugin.settings.omdbCache = c;
      await plugin.saveSettings();
    },
  );

  const seasonData: Record<number, OmdbSeasonResponse | null> = {};
  if (imdbId) {
    for (const season of seasons) {
      seasonData[season.number] = await omdb.getSeason(imdbId, season.number);
    }
  }

  for (const season of seasons) {
    container.createEl("h3", { text: `Season ${season.number}` });
    const list = container.createDiv({ cls: "st-episode-list" });
    const omdbSeason = seasonData[season.number];

    for (const ep of season.episodes) {
      const row = list.createDiv({ cls: "st-episode-row" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = ep.watched;
      row.createSpan({ text: ` E${ep.number} — ${ep.title}` });

      const omdbEp = omdbSeason?.episodes.find((e) => e.episode === ep.number);
      if (omdbEp && omdbEp.released) {
        const released = new Date(omdbEp.released);
        const aired = !isNaN(released.getTime()) && released.getTime() <= Date.now();
        if (aired && !ep.watched) {
          row.createSpan({ cls: "st-badge-pending", text: " aired, unwatched" });
        }
      }

      checkbox.addEventListener("change", async () => {
        const newLines = toggleEpisodeLine(bodyLines, ep.lineIndex, checkbox.checked);
        const newBody = newLines.join("\n");
        const newContent = fmMatch ? fmMatch[0] + newBody : newBody;
        await app.vault.modify(file, newContent);
        onChange();
      });
    }
  }
}
