# Series Tracker

Obsidian plugin: a TrackSeries-style dashboard and episode checklist for
`Media/Series/*.md` notes in the SecondBrain vault.

## Install (local, not on community plugin store)

1. `npm install && npm run build`
2. Copy `main.js`, `manifest.json`, `styles.css` into
   `<vault>/.obsidian/plugins/series-tracker/`
3. Add `"series-tracker"` to `<vault>/.obsidian/community-plugins.json`
4. Restart Obsidian, enable it in Settings → Community plugins if needed.
5. Set your OMDb API key in Settings → Series Tracker.

## Note format

The dashboard only picks up notes under the configured series folder
(default `Media/Series/`) whose frontmatter includes `type: series` — any
note missing that field is silently skipped.

A tracked series note looks like this:

```markdown
---
type: series
title: The Gentlemen
status: watching
rating: 8
image: https://example.com/poster.jpg
source_url: https://www.imdb.com/title/tt13210838/
---

## Season 1
- [x] E1 — Refined Aggression
- [ ] E2 — Tackle Tommy Woo Woo

## Season 2
- [ ] E1 — The Road to Kingdom
```

Frontmatter fields:

- `type` (required) — must be exactly `series` for the note to appear on
  the dashboard.
- `title` — shown on the dashboard card and detail view.
- `status`, `rating` — optional metadata, `status` defaults to
  `want-to-watch` if omitted.
- `image` — poster URL. Must be an **absolute URL** (e.g.
  `https://...`); the dashboard grid renders it directly as an `<img src>`
  and does not resolve vault-relative paths.
- `source_url` — an IMDb title URL (e.g.
  `https://www.imdb.com/title/tt13210838/`). When present, its IMDb id is
  used to fetch season/episode air dates from OMDb.

Body format:

- Each season starts with a `## Season N` heading (e.g. `## Season 1`).
- Episodes are listed as Markdown task list items directly under a season
  heading, in the form `- [ ] E<number> — <title>` (unchecked) or
  `- [x] E<number> — <title>` (checked/watched). Toggling the checkbox in
  the dashboard's detail view updates this line in place in the note.

## Development

`npm run dev` starts esbuild in watch mode — re-copy `main.js` into the
vault's plugin folder after each change (or symlink it) and reload Obsidian
(Cmd+P → "Reload app without saving") to see changes.
