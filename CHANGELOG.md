# Changelog

All notable changes to Inference Machine are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A popup, opened from the ribbon, the **Open** command or a per-template **Derive with** command, that runs a template on the current note and creates the result as a new note, with a preview you can edit first.
- Engines for Anthropic, OpenAI, Google Gemini and OpenAI-compatible servers, with model listing, **Test**, streaming where the server allows it, and automatic LM Studio detection, including token authentication.
- Templates with Web Clipper's variables, filters, logic and inline prompts, five built-in templates, and import and export as JSON files.
- Tag handling: source tags carried over, one spelling per tag, valid tags only, and optional AI tagging that reuses your vault's tags and prefixes.
- A warning before sending a note that looks too long for the engine's context window.
- Example templates to import: Recipe card, Book reference and Movie reference.
