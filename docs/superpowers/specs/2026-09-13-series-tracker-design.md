# Series Tracker (Obsidian Plugin) — Design

## Goal
A custom Obsidian plugin that renders a TrackSeries-style dashboard and
per-show episode grid on top of the existing `Media/Series/*.md` notes in
Ahmed's SecondBrain vault, without changing how those notes are stored.

## Architecture
Standard community-plugin shape: TypeScript compiled with esbuild to a single
`main.js`, loaded into `.obsidian/plugins/series-tracker/` in the vault.
Registers one ribbon icon + command that opens a custom `ItemView`
("Series Tracker"). No separate database — the plugin reads and writes the
same markdown files Bases/Dataview already use, so nothing breaks if the
plugin is disabled.

## Components
- `src/main.ts` — plugin entry point. Registers the view, a ribbon icon, a
  command ("Open Series Tracker"), and a settings tab (OMDb API key, series
  folder path, default: `Media/Series`).
- `src/SeriesParser.ts` — given a `TFile`, extracts:
  - frontmatter fields (`title`, `status`, `rating`, `image`, `source_url`)
  - seasons: each `## Season N` heading
  - episodes: each `- [ ] `/`- [x] ` line under a season heading, parsed as
    `{ number, title, watched }` from the `E<n> — <title>` convention already
    in use.
- `src/OmdbClient.ts` — thin fetch wrapper around the OMDb API
  (`?i=<imdbID>&Season=<n>`), extracting `imdbID` from `source_url`. Caches
  responses in plugin data (`this.saveData`) keyed by `imdbID:season` with a
  timestamp, re-fetched after 24h.
- `src/DashboardView.ts` — the `ItemView`. Top: stat tiles (episodes
  watched/total, shows in progress, shows tracked) computed by summing all
  parsed series. Below: a card grid (poster via `image` frontmatter field,
  title, progress bar) — clicking a card switches the view to that show's
  detail state.
- `src/ShowDetailView.ts` — season tabs (one per `## Season N`), episode list
  below with a checkbox per episode. Checking a box writes the corresponding
  `- [ ]`→`- [x]` change back into the actual note via the Obsidian
  `Vault.process` API (keeps the file as the source of truth). If OMDb data
  is cached for that season, an episode whose `Released` date has passed but
  isn't checked gets a small "aired, unwatched" badge.

## Data flow
1. View opens → lists files in the configured folder → parses each with
   `SeriesParser`.
2. For each show with a resolvable `imdbID`, kicks off a background OMDb
   fetch per season (respecting the 24h cache) — dashboard renders
   immediately from local data, air-date badges appear once fetches resolve.
3. User checks an episode in the plugin view → `Vault.process` rewrites that
   line in the source `.md` file → local parsed state updates → stat tiles
   recompute.

## Error handling
- No OMDb key set: plugin works fully from local checkbox data; air-date
  badges just never appear (no error shown, feature silently unavailable).
- OMDb request fails (network, rate limit): falls back to last cached
  response for that season if one exists, otherwise skips air-date data for
  that season only — doesn't block the rest of the dashboard.
- Malformed season heading/episode line (doesn't match the convention):
  skipped silently, doesn't crash the parse of the rest of the file.

## Testing
No automated tests for v1 — manual verification only:
1. `npm run dev` (esbuild watch) with output symlinked into
   `SecondBrain/.obsidian/plugins/series-tracker/`.
2. Reload Obsidian, open the view, compare against real vault data
   (The Gentlemen: 16/16 watched, Season 3 not yet added).
3. Iterate via screenshots since there's no way to inspect the rendered
   Obsidian UI programmatically from this session.

## Out of scope for v1
- Community plugin submission/review process.
- TMDB integration (OMDb only, per decision).
- Editing episode titles/adding seasons from within the plugin UI (still
  done by hand in the markdown, or via the existing OMDb-assisted workflow
  used for The Gentlemen).
