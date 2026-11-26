---
status: approved
---

# Derive a new note from selected text

Select text in a note, right-click, and run a template on just that text. **Derive from selection** opens the popup in "Selection only" mode, and a **Derive selection with** submenu runs a template straight away (Q55 C). A **Derive from selection** command does the same as the menu item, so it can have a hotkey. The result is always a new note. The source note is never changed (2.0.4, Q57).

**Related documents**
- [Product](../obsidian-inference-machine/product.md)

## User Review Required

> [!IMPORTANT]
> **What a selection run sends (Q56):** in a selection run, the engine receives the selected text instead of the whole note.
> - **From the selection:** `{{content}}` and `{{body}}` (subject to Q64), and the new `{{selection}}` variable. Leading images are looked for only at the start of the selection.
> - **From the whole source note:** the title, path, folder, properties, frontmatter, tags, source link and trigger matching. Copying the source's frontmatter properties works as it does today.
> - **Prompts that don't place the note themselves:** the built-in templates are like this. The plugin adds the filename, the source's frontmatter and the selection, labeled as selected text, instead of the whole note. So **Comprehensive summary** summarizes the selection, with the note's properties as context.

> [!IMPORTANT]
> **The submenu uses an Obsidian feature that isn't in its documented API (Q65).** Obsidian's plugin typings list no way to give a menu item its own submenu. Obsidian has one internally (`MenuItem.setSubmenu`), and many plugins use it, but a future Obsidian version could change it without notice. Q65 asks how to handle that.

> [!NOTE]
> - **Submenu runs:** picking a template in the submenu opens the popup and starts the run at once. It uses that template's remembered engine and location (from the previous spec), or its own settings. You still get the preview unless the template skips it, and the long-note warning and collision choices work as usual.
> - **What hasn't changed:**
>   - **Derive with** commands still run on the whole note.
>   - Triggers still pick the template when the popup is opened with **Derive from selection**.
>   - Choosing a template in the popup still remembers it (Q52).
> - **Where the item appears:** the menu item and command appear only when a Markdown note's editor has text selected. Whitespace alone doesn't count. In Live Preview and Source mode, that's the editor's right-click menu. Reading view has no editor selection, so it's not offered there.
> - **When the selection is read:** the selected text is captured when you open the menu or run the command. If you edit the note afterwards, the run still uses what you selected.

## Open Questions

None at this time. Q64 and Q65 were answered A, as the plan assumes:

- **Q64 (where a template can still reach the whole note):** Q56 agreed on a `{{selection}}` variable "so a template can use both the selection and the full note". But if `{{content}}` and `{{body}}` hold the selection, nothing holds the full note.
  - (A) **Recommended:** a template that uses `{{selection}}` anywhere (prompt, context, filename, properties or body) keeps the whole note in `{{content}}` and `{{body}}`. Every other template gets the selection there.
    - Built-in and existing templates work on the selection with no editing.
    - A template written for selections can say "Explain {{selection}} in the context of {{content}}".
  - (B) `{{content}}` and `{{body}}` always hold the selection in a selection run, and `{{selection}}` is the same text. That's a simpler rule, but no template can see the rest of the note during a selection run.
  - Either way, `{{selection}}` is empty in a whole-note run, as any missing value is (6.0.3).
- **Q65 (the submenu):**
  - (A) **Recommended:** use Obsidian's internal submenu. If it's missing, as it could be after a future Obsidian update, list the templates in the right-click menu itself instead, so the feature keeps working. The end-to-end tests run on the earliest and latest supported Obsidian, so a break would show up there. On mobile, the menu is only checked in desktop mobile emulation, so it needs a check on a real phone (see Manual Verification).
  - (B) Only documented API: put one **Derive selection with <template>** item per template directly in the right-click menu. That's reliable, but it adds a line per template to every right-click on selected text.
  - (C) Leave the submenu out. Keep the **Derive from selection** item, and add a **Derive selection with <template>** command per template instead, which can each have a hotkey.

Q64 A applies to TASK-3, and Q65 A to TASK-10.

## Proposed Changes

### Core: the selection in a run

#### [MODIFY] `src/core/note.ts`
- [x] **TASK-1:** Add `selection?: string` to `NoteSnapshot`, documented as the text selected for a selection run, absent for a whole-note run. Add a pure `withSelection(note, text): NoteSnapshot` that returns a copy with `selection` set. Every other field stays the whole note's, so title, properties, tags and paths keep coming from the source (Q56).

#### [MODIFY] `src/core/template/variables.ts`
- [x] **TASK-2:** Add `'selection'` to `NOTE_VARIABLES`, so templates that use it aren't flagged as having an unknown variable. `buildVariables` sets `selection` to `note.selection ?? ''`.
- [ ] **TASK-3:** (Q64 A) `VariableOptions` gains `wholeNote?: boolean`. In a selection run, `content` and `body` are the selection unless `wholeNote` is true. `frontmatter`, `properties` and the rest are unchanged. Add a pure `usesSelection(fields: string[]): boolean`, built on `referencedVariables` from `knap.ts`. It says whether any field uses `{{selection}}`.

#### [MODIFY] `src/core/template/prompt.ts`
- [ ] **TASK-4:** In `buildMainPrompt`, when the prompt doesn't use `{{content}}`, `{{body}}` or `{{selection}}` and the run is a selection run, add the following instead of the whole note:
  - `Filename: <name>`
  - the source's frontmatter block, if it has one
  - `Selected text:`, then the selection

  A whole-note run is unchanged.

#### [MODIFY] `src/core/compose.ts`
- [ ] **TASK-5:** Look for leading images in `note.selection ?? note.body`, so a selection run carries only images at the start of the selection (Q56). Pass `wholeNote` through to `buildVariables` for the filename, properties and body wrapper.

### Running

#### [MODIFY] `src/run/run-controller.ts`
- [ ] **TASK-6:** `RunInput` gains `selection?: string`. After `readNote`, a non-blank selection is applied with `withSelection`.
  - `wholeNote` is worked out once per run with `usesSelection`, over the resolved prompt, context, filename format, body format and property values. It's passed to every `buildVariables` call (prompt, context and compose), so all fields agree.
  - The long-note check works on what's actually sent, so a short selection from a long note no longer triggers it.

### The popup

#### [MODIFY] `src/ui/derive-modal.ts`
- [ ] **TASK-7:** `DeriveOptions` gains two fields:
  - `selection?: { path: string; text: string }`: the source note and the captured text.
  - `runNow?: boolean`: start the run as soon as the popup opens.

  `prefill()` uses `selection.path` as the source when it's set, even if another note is active.
- [ ] **TASK-8:** In selection mode, the **Source note** row shows `<path> · Selection only (<n> words)`, and gets a **Use whole note** button that leaves selection mode for this popup. Picking another note with **Change** also leaves selection mode. `run()` passes `selection.text` to `controller.start` while selection mode is on.
- [ ] **TASK-9:** With `runNow`, once setup is rendered, start the run if it could start: a source, a template and an engine, and a valid location. Otherwise stay on setup, which already shows why. A template chosen this way counts as picked (22.0.5), so triggers don't replace it.

### Entry points

#### [MODIFY] `src/main.ts`
- [ ] **TASK-10:** Register an `editor-menu` handler with `registerEvent`. It adds items when the editor has a non-blank selection and its file is a Markdown note:
  - **Derive from selection** (icon `sparkles`), in the plugin's own menu section: opens the popup with `selection`.
  - (Q65 A) **Derive selection with** (icon `sparkles`), with a submenu that lists every template by name. Picking one opens the popup with `templateId`, `selection` and `runNow: true`.
  - The submenu comes from `setSubmenu` when the item has it, reached through a typed check rather than an unchecked cast. Otherwise each template becomes its own **Derive selection with <name>** item in the same section.
- [ ] **TASK-11:** Add a **Derive from selection** command (`derive-selection`) with `editorCheckCallback`. It's available only with a non-blank selection in a Markdown note, and does what the menu item does. Obsidian shows it as **Inference Machine: Derive from selection**.

### Documentation

#### [MODIFY] `README.md`
- [ ] **TASK-12:** Add a **Deriving from selected text** section after **Getting started**. Also update the **Variables** table:
  - **The section:** covers the right-click item, the submenu and the command, what comes from the selection and what from the whole note, and that the source isn't changed.
  - **Variables table:** adds `{{selection}}`, and says that in a selection run `{{content}}` and `{{body}}` hold the selection unless the template uses `{{selection}}` (Q64 A).

### Tests

#### [MODIFY] `test/core/*.test.ts` (variables, prompt, compose, note)
- [ ] **TASK-13:** Unit tests for the cases under Automated Tests, items 1 to 5.

#### [NEW] `test/e2e/specs/selection.e2e.ts`
- [ ] **TASK-14:** End-to-end scenarios in real Obsidian, for the cases under Automated Tests, items 6 to 9. The mock server's `/__requests` log is used to check what was sent.

## Verification Plan

### Automated Tests
The project's Vitest suite (`npm test`, with its coverage thresholds) and the wdio end-to-end suite (`npm run test:e2e`), as in the previous specs:

1. **Variables:**
   - In a selection run, `{{content}}`, `{{body}}` and `{{selection}}` are the selection, while `{{title}}`, `{{properties}}`, `{{frontmatter}}` and `{{path}}` are the whole note's.
   - With `wholeNote`, `{{content}}` and `{{body}}` are the whole note.
   - In a whole-note run, `{{selection}}` is empty.
   - `selection` is a known variable.
2. **`usesSelection`:** true when any field uses `{{selection}}`, including inside a filter or a logic tag, and false otherwise.
3. **Main prompt:**
   - A prompt without `{{content}}`, `{{body}}` or `{{selection}}` gets the filename, the frontmatter and the labeled selection, and not the rest of the note.
   - A prompt that places the text itself gets nothing added.
4. **Leading images:** a selection that starts with an image carries it, and an image at the start of the note but outside the selection isn't carried.
5. **Tags and properties:** a selection run still merges the whole source's frontmatter and inline tags, and copies its properties.
6. **Right-click:** with text selected in `Alpha.md`, the editor menu shows **Derive from selection** and **Derive selection with**. With no selection, it shows neither.
7. **Popup in selection mode:**
   - **Derive from selection** opens the popup showing "Selection only".
   - Running it sends a request that contains the selected text but not text outside it.
   - The preview's note links back to `Alpha.md`.
   - **Use whole note** sends the whole note.
8. **Submenu:** picking **Action items** from the submenu runs it without pressing Run and shows the preview, using its remembered folder.
9. **Command:** **Inference Machine: Derive from selection** is offered only while text is selected, and opens selection mode. On mobile emulation, the command opens selection mode too.

All of this runs on the latest and earliest supported Obsidian, plus mobile emulation where the scenario applies. The existing unit and end-to-end suites must still pass, along with lint and the build.

### Manual Verification
1. In a note with a cover image at the top and several sections, select one section's text. Right-click and choose **Derive from selection**. Expect the popup to show the note's path with "Selection only" and a word count.
2. Run **Comprehensive summary** with a real engine. Expect a summary of just that section, carrying the note's properties and tags, and linking back to the note. Expect no cover image, because it isn't in the selection.
3. Select text that starts with an image embed and run again. Expect the image at the top of the new note.
4. Right-click a selection, hover **Derive selection with** and pick **Key points / TL;DR**. Expect the run to start immediately and the preview to appear.
5. Bind a hotkey to **Inference Machine: Derive from selection**, select text, and press it. Expect the popup in selection mode. With nothing selected, expect the hotkey to do nothing.
6. On a phone, select text and open the editor's context menu, or run the command from the command palette. Expect the menu item, and check that the submenu opens and can be used. This is the one place the submenu isn't covered by tests (Q65).
7. Check the source note afterwards. Expect it unchanged.

## Visual design application
No design system or art bible exists for this product. The change reuses the popup's existing **Setting** rows and Obsidian's own menus, with no new visual elements.
