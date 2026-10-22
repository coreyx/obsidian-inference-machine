# Changelog

All notable changes to Inference Machine are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/coreyx/obsidian-inference-machine/compare/0.1.1...HEAD
[0.1.1]: https://github.com/coreyx/obsidian-inference-machine/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/coreyx/obsidian-inference-machine/releases/tag/0.1.0
