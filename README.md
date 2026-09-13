# Series Tracker

An Obsidian plugin: a TrackSeries-style dashboard for TV series (episode
checklists, air-date awareness, automatic status) and movies (watchlist
grid, ratings, favourites) — reading and writing plain Markdown notes,
never owning your data.

## Features

**Series**
- Dashboard: poster grid, text + status filters, stats (episodes watched,
  shows in progress, time spent watching)
- "Next Up" spotlight (oldest aired-but-unwatched episode across all
  tracked shows) and an "Upcoming" list grouped by air date
- "Recently watched" feed
- Per-show detail view: season/episode checklists, per-episode watched-date
  stamps, "Mark season as watched", a "Refresh from TMDb" button that pulls
  in newly-aired episodes without touching your existing watch state
- Automatic status (Wishlist / Pending / Up to date / Completed), derived
  from watch state and air dates — "Abandoned" is the one status you set
  yourself and the plugin never overwrites
- Personal 0–5 rating and a freeform Notes section per show

**Movies**
- Dashboard: poster grid, text + status filters, stats
- Add via TMDb search (poster, genre, plot, etc. filled in automatically)
- Personal 0–5 rating, favourite toggle, status (Want to Watch / Watching /
  Watched — stamps a completion date), Notes section

Both sections search and fetch metadata from the free
[TMDb API](https://www.themoviedb.org/settings/api) — you'll need your own
key. TMDb was chosen over OMDb specifically because it indexes translated
titles, so searching in a non-English language (e.g. Arabic) actually finds
results — OMDb only matches a title's single primary (usually English)
listing. Notes still store an IMDb URL in `source_url` for portability; the
plugin resolves that to TMDb's internal id automatically whenever it needs
to fetch data (via TMDb's `find` endpoint, cached permanently once resolved).
Can't find something by title? Use the "Add by IMDb ID/URL" field instead —
it works regardless of search-index coverage.

## Install (local, not yet on the community plugin store)

1. `npm install && npm run build`
2. Copy `main.js`, `manifest.json`, `styles.css` into
   `<vault>/.obsidian/plugins/series-tracker/`
3. Add `"series-tracker"` to `<vault>/.obsidian/community-plugins.json`
4. Restart Obsidian, enable it in Settings → Community plugins if needed.
5. Set your TMDb API key, series folder, and movies folder in
   Settings → Series Tracker.

## Note format

### Series

The dashboard only picks up notes under the configured series folder
(default `Media/Series/`) whose frontmatter includes `type: series` — any
note missing that field is silently skipped.

```markdown
---
type: series
title: Example Show
status: watching
rating: 4
total_seasons: 2
source: manual
source_url: https://www.imdb.com/title/tt0000000/
tags: [Drama]
date_added: 2026-09-13
date_completed: ""
image: https://example.com/poster.jpg
---

## Season 1
- [x] E1 — Pilot (watched: 2026-09-13)
- [ ] E2 — Second Episode

## Season 2
- [ ] E1 — Season Opener

## Notes
```

- `type` (required) — must be exactly `series`.
- `status` — one of `want-to-watch` / `watching` / `up-to-date` / `finished`
  / `abandoned`. The first four are auto-managed from watch state; only
  `abandoned` is a pure manual choice the plugin never overwrites.
- `rating` — `0`–`5` or `null`.
- `source_url` — an IMDb title URL. When present, its IMDb id is resolved to
  a TMDb id (cached) and used to fetch season/episode air dates and series
  metadata from TMDb.
- `image` — poster URL, must be an **absolute URL**.
- Each season starts with a `## Season N` heading; episodes are Markdown
  task items directly under it, `- [ ] E<number> — <title>`. Checking a box
  in the plugin's detail view stamps `(watched: YYYY-MM-DD)` onto the line
  and rewrites that exact line in the note — nothing else in the file is
  touched.
- A `## Notes` heading (anywhere in the body) holds freeform text, editable
  from the detail view.

### Movies

Notes under the configured movies folder (default `Media/Movies/`) with
`type: movie` frontmatter:

```markdown
---
type: movie
title: "Example Movie"
status: want-to-watch
source: manual
source_url: ""
genre: ["Action", "Drama"]
language: ""
favourite: false
rating: null
tags: ["Action", "Drama"]
date_added: 2026-09-13
date_completed: ""
image: ""
---

# Example Movie
```

- `status` — one of `want-to-watch` / `watching` / `watched`. Setting it to
  `watched` from the detail view stamps `date_completed`.
- `favourite`, `rating` (`0`–`5` or `null`), `genre`/`tags` — same
  conventions as series.

## Development

`npm run dev` starts esbuild in watch mode — re-copy `main.js` into the
vault's plugin folder after each change (or symlink it) and reload Obsidian
(Cmd+P → "Reload app without saving") to see changes.

`npm test` runs the unit test suite (vitest). `npm run build` type-checks
(`tsc -noEmit`) before bundling — both must pass before a commit.

## License

MIT — see [LICENSE](LICENSE).
