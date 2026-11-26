# Walkthrough: Derive a new note from selected text

Select text in a note and right-click it. **Derive from selection** opens the popup in "Selection only" mode, and **Derive selection with** lists your templates and runs one at once. The **Inference Machine: Derive from selection** command does what the first item does, so it can have a hotkey. The engine gets the selected text, and the new note keeps the source note's title, properties, tags and link. The result is always a new note, and the source is never changed.

The decisions behind it (Q55 to Q57, Q64 A, Q65 A) and the task list are in [`implementation_plan.md`](./implementation_plan.md). The product is described in [`product.md`](../obsidian-inference-machine/product.md).

## What Was Implemented

### 1. The selection in a run (TASK-1 to TASK-6)
- **`core/note.ts`**: `NoteSnapshot` gains an optional `selection`, and `withSelection(note, text)` returns a copy with it set. Every other field stays the whole note's.
- **`core/template/variables.ts`**:
  - **New variable:** `{{selection}}` is a known variable. It holds the selection, and is empty in a whole-note run.
  - **What `{{content}}` holds:** in a selection run, `{{content}}` and `{{body}}` are the selection, unless `wholeNote` is set (Q64 A).
- **`core/template/knap.ts`**: `usesSelection(fields)` says whether any field reads `{{selection}}`, including through filters and logic tags. It lives here rather than in `variables.ts` as planned, because `knap.ts` already imports `variables.ts`, and the plan's placement would have made a circular import.
- **`core/template/prompt.ts`**: a prompt that doesn't place the text itself gets the filename, the source's frontmatter and the selection, labeled `Selected text:`, instead of the whole note. Whole-note runs are unchanged.
- **`core/tagging-request.ts`**: the AI tagging request describes the selection in a selection run.
  - This file wasn't in the plan, which named only the main prompt.
  - The plan does promise that "the engine receives the selected text instead of the whole note". Without this change, AI tagging would still have sent the whole note.
  - It's part of the TASK-4 commit.
- **`core/compose.ts`**: leading images are looked for at the start of the selection. `wholeNote` is passed through to the filename, properties and body wrapper.
- **`run/run-controller.ts`**:
  - **Input:** `RunInput` gains `selection`. A blank selection runs on the whole note.
  - **Whole note or selection:** `wholeNote` is worked out once per run over the resolved prompt, context, filename format, body format and property values, so every field agrees.
  - **Long-note warning:** it checks what's actually sent, so a short selection from a long note doesn't trigger it.

### 2. The popup (TASK-7 to TASK-9)
- **`ui/derive-modal.ts`**:
  - **New options:** `DeriveOptions` gains `selection` (the note's path and the captured text) and `runNow`.
  - **Source note:** the selection's own note is the source, even if another note is active.
  - **Selection mode:** the **Source note** row reads `<path> · Selection only (<n> words)`. **Use whole note** leaves selection mode, and so does picking another note with **Change**.
  - **Starting at once:** with `runNow`, the run starts as soon as the popup opens, if it can. Otherwise the setup stays open and shows what's missing.
- **Process note:** TASK-9's checkbox went straight from `[ ]` to `[x]` in its commit, without the in-progress step. No commit contains `[/]`.

### 3. Entry points (TASK-10, TASK-11)
- **`main.ts`**: an `editor-menu` handler adds the two items when a Markdown note's editor has a non-blank selection.
  - **Derive selection with:** its submenu comes from Obsidian's internal `MenuItem.setSubmenu`, found through a typed check of `MenuItem.prototype` (Q65 A). If an Obsidian version lacks it, each template becomes its own **Derive selection with <name>** item instead.
  - **The command:** the **Derive from selection** command (`derive-selection`) uses `editorCheckCallback`, so it's only offered while text is selected.

### 4. Documentation (TASK-12)
- **`README.md`**: a new **Deriving from selected text** section, and the **Variables** table gains `{{selection}}` and notes what `{{content}}` and `{{body}}` hold in a selection run.

## Verification & Test Results

### Automated Tests
Ran the Vitest suite (`npm test`, with its coverage thresholds): **25 files, 408 tests passed**, 12 of them new.
- **Variables:**
  - In a selection run, `{{content}}`, `{{body}}` and `{{selection}}` are the selection. `{{title}}`, `{{path}}`, `{{properties.author}}` and `{{frontmatter}}` are the whole note's.
  - With `wholeNote`, `{{content}}` and `{{body}}` are the whole note.
  - In a whole-note run, `{{selection}}` is empty.
  - `{{selection}}` raises no unknown-variable warning in any field.

  **Passed**
- **`usesSelection`:** found through a filter and an `{% if %}` tag, and not found in templates that don't use it. **Passed**
- **Main prompt:**
  - Filename, frontmatter and the labeled selection are added. Without frontmatter, that part is left out.
  - Nothing is added when the prompt uses `{{selection}}` or `{{content}}`.
  - In a whole-note run, a prompt that uses only `{{selection}}` still gets the whole note.

  **Passed**
- **Run controller:**
  - Only the selection and the frontmatter are sent. The whole note's frontmatter and inline tags are merged, its properties copied, and the link added, with the source unchanged.
  - A blank selection runs on the whole note.
  - Only images at the start of the selection are carried.
  - A template using `{{selection}}` gets the whole note in `{{body}}`.
  - AI tagging is asked about the selection.

  **Passed**
- **End to end** (new `test/e2e/specs/selection.e2e.ts`), in real Obsidian on the latest (1.15.1) and earliest supported (1.13.4) versions:
  1. **Right-click:** a real right-click on selected text shows **Derive from selection** and **Derive selection with**. With no selection, it shows neither.
  2. **Derive from selection:**
     - The popup shows `Alpha.md · Selection only (3 words)`.
     - The request the mock server received holds the selection and the frontmatter, but not the rest of the line.
     - The preview links back to `[[Alpha]]`.
     - After **Use whole note**, the whole note is sent.
  3. **Submenu:** picking **Action items** runs it without pressing Run, and saves to its remembered folder `Out/`.
  4. **Command:** offered only while text is selected, and opens selection mode. This also passes in mobile emulation.

  **Passed**
- **Problems while writing the end-to-end tests:** all were in the test code, not the plugin.
  - **Selectors:** WebdriverIO can't put a text match after a CSS descendant selector. The line is found within the active pane, and menu items by exact title with XPath.
  - **Checking the command:** `executeCommandById` doesn't report whether a command is offered, so the test asks the command's own check, as the command palette does.
  - **Reading the request log:** the test reads the mock server's log with `node:http`. This project's lint rules don't allow `fetch` or turning that rule off.

### Regression Testing
- **End to end:** the full suite ran in real Obsidian, and **all 18 spec runs passed**, across latest desktop, earliest desktop and mobile emulation. That includes the popup flows, triggers, remembered choices and the restart scenarios.
- **Lint and build:**
  - `eslint .` passes. Its only warning is the existing, intended `fetch` in `src/engines/transport.ts`.
  - The production build passes.

## Manual Verification

These steps cover what the tests can't: a real model, a phone, and hotkeys.

1. In a note with a cover image at the top and several sections, select one section's text. Right-click and choose **Derive from selection**. Expect the popup to show the note's path, "Selection only" and a word count.
2. Run **Comprehensive summary** with a real engine. Expect:
   - a summary of just that section
   - the note's properties and tags, and a link back to the note
   - no cover image, because it isn't in the selection
3. Select text that starts with an image embed and run again. Expect the image at the top of the new note.
4. Right-click a selection, hover **Derive selection with** and pick **Key points / TL;DR**. Expect the run to start immediately and the preview to appear.
5. Bind a hotkey to **Inference Machine: Derive from selection**, select text, and press it. Expect the popup in selection mode. With nothing selected, expect the hotkey to do nothing.
6. On a phone, select text and open the editor's context menu, or run the command from the command palette. Expect the menu item, and check that the submenu opens and can be used. Only mobile emulation on the desktop is tested, and there only the command.
7. Check the source note afterwards. Expect it unchanged.

## Follow-ups
- **The submenu relies on Obsidian internals:** if a future Obsidian removes `setSubmenu`, the templates are listed in the right-click menu itself. If a version keeps the method but changes how it behaves, the end-to-end submenu scenario should catch it.
- **Reading view:** it has no editor selection, so nothing is offered there. Supporting it would mean reading the DOM selection and mapping it back to the note's text.
- **Inline tags:** a selection run merges the whole note's tags, inline ones included (Q56). Taking inline tags only from the selection would be a small change, if wanted.
