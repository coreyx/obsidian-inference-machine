---
status: approved
---

# Save derived notes in a folder inside the source note's folder

Output location gets a third choice, **Next to the source note, in a specified folder**. It saves the new note in a folder inside the source note's own folder, so a note in `Reading/` with the folder `AI/Summaries` is saved in `Reading/AI/Summaries/`. The choice is available everywhere output location is set today: the global defaults, each template, and the popup.

**Related documents**
- [Product](../obsidian-inference-machine/product.md)

## User Review Required

> [!IMPORTANT]
> The new choice is saved as a new location type, `{ mode: 'subfolder', path }`. Version 0.2.0 and earlier don't know this type. They report it as an invalid output location and fall back to the default. This happens if you go back to an older version after using the new choice, or import an exported template that uses it into one.

## Open Questions

None at this time. The decisions behind this plan are Q58 and Q59:

- **The folder is a plain relative path inside the source note's folder (Q58 A).** It can be nested, like `AI/Summaries`. A path that leads out of the source note's folder through `..` isn't allowed. Missing folders are created, as they are for **In a folder** today (10.0.2).
- **An empty folder means next to the source note (Q59 A).** Run isn't blocked.

## Proposed Changes

### Location model

#### [MODIFY] `src/core/schema.ts`
- [x] **TASK-1:** Add the third location type to `OutputLocation`: `{ mode: 'subfolder'; path: string }`.
  - Document `path` as relative to the source note's folder.
  - Note that an empty path means the source note's own folder.

#### [NEW] `src/core/location.ts`
- [x] **TASK-2:** Add `subfolderSegments(path: string): { segments: string[] } | { error: string }`, a pure check for the relative path.
  - It splits on `/` and `\`, trims each segment, and drops empty segments and `.`.
  - A leading or trailing slash is therefore ignored, so `/AI/` means `AI`.
  - A `..` segment returns the error `The folder "<path>" leads out of the source note's folder.`
  - An empty or whitespace-only path returns no segments.
  - It has no Obsidian imports, so it can be unit-tested and used by both validation and the UI.

#### [MODIFY] `src/core/data-validation.ts`
- [x] **TASK-3:** Accept `{ mode: 'subfolder', path: string }` in `checkLocation`.
  - A path that `subfolderSegments` rejects is reported as `<label>: output location leads out of the source note's folder` and dropped, like any other invalid location.
  - Templates, global settings, imports and the remembered popup location all load through `checkLocation`, so they all accept the new type.

#### [MODIFY] `src/obsidian/note-writer.ts`
- [x] **TASK-4:** Extend `outputFolder` for `subfolder`.
  - It joins the source note's folder with the segments from `subfolderSegments`, then normalizes the result as it does today.
  - A source note at the vault root gives just the segments.
  - No segments gives the source note's folder.
  - If the path leads out of the folder, it throws an `Error` with the message from `subfolderSegments`. The popup then shows it as a failed run and keeps every selection (8.0.6). Normally loading drops such a path first, but a value typed into the popup is never loaded, so the run has to check it too.

### Settings and template editor

#### [MODIFY] `src/ui/settings-tab.ts`
- [x] **TASK-5:** Add the choice to **Output defaults → Location**.
  - Option `subfolder`, labeled **Next to the source note, in a specified folder**.
  - A **Folder** text control, `location.subfolderPath`, shown only for this choice. Its placeholder is `Folder inside the source note's folder`, and its description gives the `AI/Summaries` example.
  - It is plain text, not the vault folder picker, because the folder depends on each source note.
  - `saveControl` and `getControlValue` handle `location.mode = 'subfolder'` and `location.subfolderPath`, trimming the path as `location.path` does.
  - Switching between the two folder choices keeps whatever path is already typed.
  - If the typed path leads out of the source note's folder, the control's description shows the error from `subfolderSegments` and the value isn't saved.

#### [MODIFY] `src/ui/template-editor.ts`
- [x] **TASK-6:** Add the same option to the template's **Location** dropdown.
  - When it's chosen, a plain text field is shown with the same placeholder.
  - The **Inherit (…)** label describes an inherited folder of this kind as `next to the source, in <path>`, or `next to the source` when the path is empty.
  - If the path leads out of the source note's folder, an error is shown under the field and the template can't be saved, as for the editor's other invalid fields.

### Popup

#### [MODIFY] `src/ui/derive-modal.ts`
- [ ] **TASK-7:** Add the option to the popup's **Output location** dropdown.
  - When it's chosen, a plain text field with the same placeholder is shown, and `locationOverride` is set to `{ mode: 'subfolder', path }` as the user types.
  - Switching between **In a folder** and this choice carries the typed path over.
  - The setting's description previews where the note will go, `Saves in <resolved folder>/` (or `Saves in the vault root` for a root-level source), and updates as you type. When no source note is chosen yet, the description is empty.
  - A path that leads out of the source note's folder shows the error in the description and disables **Run**.
  - The remembered popup location (19.0.3) already round-trips through `checkLocation`, so it remembers this choice with no further change.

### Documentation

#### [MODIFY] `README.md`
- [ ] **TASK-8:** In **What a template sets**, describe the three output locations, with the `Reading/` + `AI/Summaries` → `Reading/AI/Summaries/` example. Say that an empty folder means next to the source note and that `..` isn't allowed.

### Tests

#### [MODIFY] `test/core/data-validation.test.ts`, [NEW] `test/core/location.test.ts`, [MODIFY] `test/obsidian/adapters.test.ts`, `test/core/resolve.test.ts`, `test/obsidian/settings-store.test.ts`, `test/core/template-transfer.test.ts`
- [ ] **TASK-9:** Unit tests for the cases listed under Automated Tests, items 1 to 4.

#### [MODIFY] `test/e2e/specs/derive.e2e.ts`
- [ ] **TASK-10:** Extend the location scenario (10.1, 10.2) with this choice.
  - Open `Meetings/2026-10-01.md`, choose the new option, and type `AI/Summaries`.
  - Expect `Saves to Meetings/AI/Summaries/2026-10-01 - Comprehensive summary.md`.
  - Save, and check that the file exists.

## Verification Plan

### Automated Tests

As in the previous spec, this project tests with Vitest and enforces coverage thresholds, so the checks go in the existing suite (`npm test`) instead of a `scratch/` script. The end-to-end suite (`npm run test:e2e`) covers the popup.

1. **`subfolderSegments`:**
   - `AI/Summaries` gives `['AI', 'Summaries']`.
   - `/AI/` and ` AI ` give `['AI']`.
   - `AI\Summaries` gives `['AI', 'Summaries']`.
   - `./AI` gives `['AI']`.
   - `''` and `'  '` give `[]`.
   - `../Elsewhere`, `AI/../..` and `..` give the error.
2. **`checkLocation`:**
   - It accepts `{ mode: 'subfolder', path: 'AI' }` and `{ mode: 'subfolder', path: '' }`.
   - It reports and drops `{ mode: 'subfolder' }` with no path, and `{ mode: 'subfolder', path: '../x' }`.
3. **`outputFolder`:**
   - With source folder `Projects`, the path `AI/Summaries` gives `Projects/AI/Summaries`.
   - A root-level source gives `AI/Summaries`.
   - An empty path gives `Projects`.
   - `../x` throws.
   - The existing **alongside** and **In a folder** cases are unchanged.
4. **Resolution, loading and transfer:**
   - A template's subfolder location wins over the global one, and the popup's wins over the template's.
   - A `data.json` with a subfolder global location and a subfolder `ui.lastLocation` loads them unchanged.
   - An exported template with a subfolder location imports intact.
5. **End to end:** the scenario in TASK-10.

### Manual Verification

1. Under **Settings → Inference Machine → Output defaults**, set **Location** to **Next to the source note, in a specified folder**. Check that a **Folder** field appears. Type `../x` and expect an error under the field. Replace it with `AI/Summaries`.
2. Open a note in a folder, such as `Reading/dune-notes.md` in the demo vault, and open Inference Machine. Expect **Output location** to show the new option, `AI/Summaries`, and `Saves in Reading/AI/Summaries/`. Run, and check that the preview says `Saves to Reading/AI/Summaries/…`. Save, and check in the file explorer that `Reading/AI/Summaries/` was created and holds the note.
3. Open a note at the vault root, such as `Alpha.md`, run the popup, and expect `Saves to AI/Summaries/…`.
4. In the popup, clear the folder field. Expect `Saves in Reading/`, and the saved note next to the source.
5. Edit a template, set its **Location** to the new option with folder `Digests`, and save. Open the popup on `Reading/dune-notes.md` with that template, and expect `Reading/Digests/`. Set the template back to **Inherit** and check that the label reads `Inherit (next to the source, in AI/Summaries)`.
6. In the popup, switch between **In a folder** and the new option, and check that the typed path carries over.
7. Close the popup after a run and open it again. Expect the new option and its folder to be remembered.

## Visual design application

The new controls use Obsidian's own settings components, as the existing location controls do. No design system or art bible exists for this product, so there's nothing to apply.
