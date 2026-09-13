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

## Development

`npm run dev` starts esbuild in watch mode — re-copy `main.js` into the
vault's plugin folder after each change (or symlink it) and reload Obsidian
(Cmd+P → "Reload app without saving") to see changes.
