# Release notes

## 0.2.0 (2026-10-22)

New notes now carry over the source note's leading images and its properties. To update now, run **BRAT: Plugins: Check for updates to all beta plugins and UPDATE** from the command palette.

### Leading images come along

If the source note starts with an image, such as a cover, a banner or a photo under its title, the new note starts with it too. An image counts as leading when only headings, blank lines or other images come before it. The image stays where it is in your vault, and the new note embeds it with a link written for the new note's folder, so it still shows wherever the note is saved. A size like `|300` or a caption is kept, and an image the model already included isn't added twice.

### Properties come along

The source note's properties are copied into the new note. A template's own properties still come first, so a built-in's `created` date is always the day you ran it. Tags are merged as before, and `aliases` and `cssclasses` aren't copied, so the new note doesn't show up under the source's names or take on its styling. Change that list under **Properties not to copy**.

### Your choice, per template

Both are on by default, under **Carry over from the source** in the plugin's settings, and each template can turn either one on or off. The built-ins start with sensible choices: Action items doesn't carry images, Flashcards carries neither, and the Recipe card, Book reference and Movie reference examples carry their photo, cover or poster but keep their own properties. Built-ins you haven't edited update themselves. Re-import the examples to get their new settings.

### Worth knowing

- Your own templates carry images and properties too, unless you turn the settings off.
- A copied property can make the new note match the same property trigger as its source. For example, a summary of a `type: book` note also gets `type: book`. Add `type` to **Properties not to copy** if you'd rather it didn't.

## 0.1.1 (2026-10-21)

A small fix to how new notes are laid out. To update now, run **BRAT: Plugins: Check for updates to all beta plugins and UPDATE** from the command palette.

### A blank line after every heading

Every heading in a new note is now followed by a blank line, whichever template or model wrote it, the `# References` heading included. Before, some notes had text, lists and the link back to the source directly under their headings.

The built-in templates' prompts now show the same layout. If you haven't edited a built-in template, it updates itself. If you imported the Recipe card, Book reference or Movie reference example, import it again to get the new layout in the template, though notes it creates get the blank lines either way.

### Install steps

The README's BRAT steps now match BRAT 2.2.0.

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
