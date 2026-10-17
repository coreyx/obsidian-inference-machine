# Demo vault

Sample notes for trying and demonstrating Inference Machine: a rough recipe, a note about a book, a note about a film, a meeting note, a Web Clipper-style clipping and a study note.

- `npm run demo` opens this vault in a sandboxed Obsidian with the plugin installed and hot-reloading. The vault's plugin settings (engines and templates) persist in `demo/vault/.obsidian`, but API keys live in the sandbox's secret storage, so enter them again each time you launch it this way.
- `npm run demo:install` builds the plugin and installs it into this vault. Then open `demo/vault` in your own Obsidian, where keys you enter stay in that Obsidian's secret storage.

`demo/vault/.obsidian/` isn't committed: it holds per-machine state and the plugin's settings. To try the example templates, import the files in [`examples`](../examples) from **Settings → Inference Machine**.
