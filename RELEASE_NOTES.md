# Release notes

## 0.1.0 (2026-10-19)

The first release of Inference Machine: derive a new note from an existing one with an AI model, the way Web Clipper turns a web page into a note. Install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using `coreyx/obsidian-inference-machine`; the [README](README.md#installation) has the steps. It needs Obsidian 1.13.4 or later, and works on desktop and mobile.

### Turn any note into a new one

Open a note, click the sparkles icon in the ribbon or run **Inference Machine: Open**, pick a template and click **Run**. The output streams in, then a preview shows exactly the note that will be created, which you can edit before saving. Nothing is written until you click **Save**, and the source note is never changed. The new note goes in a folder you choose or next to the source, with a link back to it.

### Set up a model once

Add an engine for Anthropic, OpenAI, Google Gemini or any OpenAI-compatible server, and use it with every template. **Detect LM Studio** finds a local LM Studio server and sets the engine up for you, with or without a token. API keys are kept in Obsidian's secret storage, never in the plugin's settings or your notes.

### Templates

Five built-in templates cover the common jobs: Comprehensive summary, Key points / TL;DR, Action items, Flashcards and Literature note. Write your own with Web Clipper's variables, filters and inline prompts, or import the Recipe card, Book reference and Movie reference examples. Each template can have its own command and hotkey, and template triggers preselect the right template for a note by its tags, folder, properties, title or contents.

### Tags you can trust

The source note's tags carry over, each tag appears only once however it's spelled, and invalid tags are fixed or left out. Optional AI tagging suggests tags that reuse the ones already in your vault.

### Local and reasoning models

Reasoning models work: their `<think>` working never reaches your note, and an answer cut short by the output limit is explained. For LM Studio, the long-note warning uses the context length the model is actually loaded with, and an engine can load the model at its own context window before each run.

### Known limits

- Inference Machine isn't in the Community Plugins directory yet, so install it with BRAT or by hand.
- API keys stay on the device they were entered on, so add them again on each device.
- A local model runs much more slowly if it and its context don't fit in GPU memory. Use a smaller context window if runs are slow.
