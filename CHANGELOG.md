# Changelog

All notable changes to Inference Machine are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Derive from selected text:** select text in a note and right-click it. **Derive from selection** opens the popup on just that text, and **Derive selection with** lists your templates and runs one straight away, with its remembered engine and location. The **Inference Machine: Derive from selection** command does the same as the first item and can have a hotkey. The engine gets the selected text, and the new note keeps the source note's title, properties, tags and link back. Only images at the start of the selection are carried. The result is always a new note.
- **`{{selection}}` variable:** the selected text. In a selection run, `{{content}}` and `{{body}}` hold the selection, unless the template uses `{{selection}}`, which keeps them as the whole note so the template can use both.

## [0.4.0] - 2026-11-25

### Added

- **Use template settings:** a popup button that forgets the engine and location remembered for the current template, so its own settings apply again.

### Changed

- **The popup remembers your choices as soon as you make them,** even if you close it without running. The last template is remembered for the whole vault, and the engine and output location for each template separately, so a choice made for one template never changes another. Template commands and triggers still pick the template first.
- **The single remembered output location is gone.** Before, the last location chosen in the popup applied to every template and beat a template's own location. After updating, each template starts from its own location until you change it in the popup.
- **Changing a template's engine or location in its settings resets what the popup remembered for it,** so the new setting takes effect.

## [0.3.0] - 2026-11-24

### Added

- **Next to the source note, in a specified folder:** a third output location, which saves the new note in a folder inside the source note's folder. With `AI/Summaries`, a note from `Reading/` is saved in `Reading/AI/Summaries/`. It can be set in the output defaults, in a template or in the popup, and missing folders are created. An empty folder means next to the source note. A folder that leads out of the source's folder with `..` is refused before anything is sent. Version 0.2.0 and earlier don't recognize this location and fall back to the default.

## [0.2.0] - 2026-10-22

### Added

- **Carry leading images:** the images at the front of the source note, such as a cover or banner, are put at the top of the new note, relinked so they still show from its folder. This is on by default, and a template can turn it off. Action items and Flashcards don't carry images.
- **Copy the source's frontmatter:** the source note's properties are copied into the new note, under the template's own properties and any the model writes. Tags are merged as before, and **Properties not to copy** (`aliases, cssclasses` to start) are left out. This is on by default, and a template can turn it off. Flashcards and the example templates don't copy properties.

## [0.1.1] - 2026-10-21

### Changed

- The README's BRAT install steps match BRAT 2.2.0.

### Fixed

- Every heading in a new note is now followed by a blank line, whichever template or model wrote it, the `# References` heading included. The example outputs in the built-in templates' prompts and the example templates now show the blank line too. Unedited built-in templates update themselves; an imported example template needs importing again to get the new layout.

## [0.1.0] - 2026-10-19

The first release, installable with BRAT.

### Added

- A popup, opened from the ribbon, the **Open** command or a per-template **Derive with** command, that runs a template on the current note and creates the result as a new note, with a preview you can edit first.
- Engines for Anthropic, OpenAI, Google Gemini and OpenAI-compatible servers, with model listing, **Test**, streaming where the server allows it, and automatic LM Studio detection, including token authentication.
- Templates with Web Clipper's variables, filters, logic and inline prompts, five built-in templates, and import and export as JSON files.
- Tag handling: source tags carried over, one spelling per tag, valid tags only, and optional AI tagging that reuses your vault's tags and prefixes.
- A warning before sending a note that looks too long for the engine's context window.
- Example templates to import: Recipe card, Book reference and Movie reference.
- Template triggers: rules by tag, folder, property, filename or contents that preselect a template in the popup.
- Support for reasoning models: `<think>` working is removed from responses, the output limit is only sent when set (Anthropic gets 8,192), and an answer cut short by reasoning is reported as such.
- For LM Studio engines, the context length the model is loaded with is shown in the engine's settings and used for the long-note warning, and an engine can load the model with its own context window before each run.

[Unreleased]: https://github.com/coreyx/obsidian-inference-machine/compare/0.4.0...HEAD
[0.4.0]: https://github.com/coreyx/obsidian-inference-machine/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/coreyx/obsidian-inference-machine/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/coreyx/obsidian-inference-machine/compare/0.1.1...0.2.0
[0.1.1]: https://github.com/coreyx/obsidian-inference-machine/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/coreyx/obsidian-inference-machine/releases/tag/0.1.0
