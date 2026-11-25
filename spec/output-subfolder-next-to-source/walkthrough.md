# Walkthrough: Save derived notes in a folder next to the source

Output location has a third choice, **Next to the source note, in a specified folder**. It saves the new note in a folder inside the source note's own folder, so a note from `Reading/` with the folder `AI/Summaries` goes to `Reading/AI/Summaries/`. The choice works in the global defaults, in each template and in the popup. An empty folder means next to the source note, and a folder that leads out of the source's folder with `..` is refused.

The decisions behind it (Q58, Q59) and the task list are in [`implementation_plan.md`](./implementation_plan.md). The product is described in [`product.md`](../obsidian-inference-machine/product.md).

## What Was Implemented

### 1. The location and its check (TASK-1 to TASK-4)
- **`core/schema.ts`**: `OutputLocation` gains `{ mode: 'subfolder'; path }`, with the path relative to the source note's folder.
- **`core/location.ts`** (new): `subfolderSegments` splits the path into its parts.
  - Both `/` and `\` separate parts.
  - Empty parts and `.` are dropped, so `/AI/`, ` AI ` and `./AI` all mean `AI`.
  - An empty path means the source note's own folder.
  - A `..` part is refused with a message naming the path. A name that merely contains dots, like `v1..2`, is kept.
- **`core/data-validation.ts`**: `checkLocation` accepts the new type for global settings, templates, imports and the remembered popup location. A path containing `..` is reported and dropped, like any other invalid location.
- **`obsidian/note-writer.ts`**: `outputFolder` joins the source note's folder with the parts. A root-level source note gives just the parts. A path that leads out of the folder throws.
- **`run/run-controller.ts`**: the run checks the folder right after resolving its settings, **before anything is sent**. A refused folder fails the run without spending a request. The plan only said the check would happen when the path is planned, after the requests. Checking earlier keeps a typo from costing a request.

### 2. Settings, template editor and popup (TASK-5 to TASK-7)
- **`ui/subfolder-field.ts`** (new): `addSubfolderField` adds the plain text field, with the placeholder "Folder inside the source note's folder". As you type, it updates the row's description in place, without re-rendering, so the cursor stays put. The description is either the caller's preview of the folder or the reason the path is refused. A refused path also turns the description red, through the new `.im-invalid` class in `styles.css`.
- **`ui/settings-tab.ts`**: **Output defaults → Location** has the new option and a **Folder** field.
  - The plan described the field as a declared text control. It's rendered by hand instead, because a declared control can't show an error while you type.
  - A refused path isn't saved.
  - Switching between the two folder choices keeps the typed path. The tab rebuilds on a location switch so the field shows it.
- **`ui/template-editor.ts`**: the template's **Location** dropdown has the option. **Inherit (…)** reads `next to the source, in <path>`. A refused path blocks **Save** with the error, like the editor's other checks.
- **`ui/derive-modal.ts`**: the popup's **Output location** has the option, with a live preview such as `Saves in Meetings/AI/Summaries/`. A refused path shows the error and disables both **Run** and Mod+Enter. Switching between the two folder choices keeps the typed path. The remembered popup location handles the new type with no further change.

### 3. Documentation (TASK-8)
- **`README.md`**: **What a template sets** now describes the three output locations, with the `Reading/` → `Reading/AI/Summaries/` example.

## Verification & Test Results

### Automated Tests
Ran the Vitest suite (`npm test`), which enforces the coverage thresholds: **24 files, 380 tests passed**. Of these, 15 tests are new for this change, and one existing test was extended:
- `subfolderSegments`: nested paths, slashes, spaces, `.`, backslashes, empty paths, and refusing `..` while keeping names that contain dots. **Passed**
- `checkLocation`: accepts a subfolder location, including an empty one. It reports a missing path, and reports and drops a `..` path. **Passed**
- `outputFolder`: a nested folder under `Projects`, a root-level source, an empty path, and throwing on `..`. **Passed**
- Run controller:
  - A run into `AI/Summaries` creates `Projects/AI` and `Projects/AI/Summaries` and saves there. **Passed**
  - A `../Elsewhere` folder fails with the readable message, and the engine receives no request. **Passed**
- Resolution: popup over template over global, for the new type. **Passed**
- Loading: a subfolder global location and remembered location load unchanged. A remembered `..` path is dropped. **Passed**
- Template transfer: a subfolder location survives export and import. **Passed**
- End to end (`npm run test:e2e`, real Obsidian, latest and earliest supported versions):
  - In the popup, `../Elsewhere` shows the error and disables **Run**.
  - `AI/Summaries` previews `Saves in Meetings/AI/Summaries/`.
  - The preview path and the saved file are both in `Meetings/AI/Summaries/`.

  **Passed**

`eslint .` and the production build (`npm run build`) pass as well.

### Regression Testing
- The full end-to-end suite ran in real Obsidian: **all 9 spec files passed**. That covers the desktop popup flows on the latest and earliest Obsidian, triggers, and mobile emulation. It includes the existing scenarios for **In a folder** and **next to the source** (10.1, 10.2), remembering the last template (19.3), keyboard-only use (19.2), and the settings search check.
- The existing location, resolution and loading unit tests pass unchanged.

## Manual Verification

The settings tab's and template editor's new field has no automated test. The end-to-end test covers the popup only. Please check these by hand:

1. Open **Settings → Inference Machine → Output defaults** and set **Location** to **Next to the source note, in a specified folder**.
   - Check that a **Folder** field appears, with the placeholder "Folder inside the source note's folder".
   - Type `../x` and expect a red message saying the folder leads out of the source note's folder.
   - Replace it with `AI/Summaries` and expect `Saves a note from Reading/ in Reading/AI/Summaries/.`
2. Close and reopen settings. Expect the choice and `AI/Summaries` to be kept.
3. Switch **Location** to **In a folder**, and expect `AI/Summaries` in its folder field. Switch back.
4. Open `Reading/dune-notes.md` in the demo vault and open Inference Machine.
   - Expect the new option, `AI/Summaries`, and `Saves in Reading/AI/Summaries/`.
   - Run and save. Check in the file explorer that `Reading/AI/Summaries/` was created and holds the note.
5. Open `Alpha.md` at the vault root and run again. Expect `Saves to AI/Summaries/…`.
6. In the popup, clear the folder field. Expect `Saves in Reading/`, with **Run** enabled, and the note saved next to the source.
7. Edit a template.
   - Set its **Location** to the new option, type `../x`, and click **Save**. Expect the error and no save.
   - Change the folder to `Digests` and save. Run the template on `Reading/dune-notes.md`, and expect `Reading/Digests/`.
   - Set the template's **Location** back to **Inherit** and check that it reads `Inherit (next to the source, in AI/Summaries)`.

## Follow-ups
- **Next to the source note, in a specified folder** offers no folder suggestions, because the folder depends on each source note. The popup could suggest existing folders inside the current source's folder, if that turns out to be wanted.
- Version 0.2.0 and earlier report the new location type as invalid and fall back to the default. That happens if you go back to an older version after using it, or import an exported template that uses it into one. The CHANGELOG entry notes this.
- The next two specs build on this one: `popup-remember-selections`, then `derive-from-selection`.
