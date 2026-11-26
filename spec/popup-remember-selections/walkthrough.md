# Walkthrough: Remember the popup's choices, per template

The Inference Machine popup now remembers your choices the moment you make them, even if you close it without running. The last template is remembered for the whole vault. The engine and output location are remembered for each template separately. Template commands and triggers still pick the template first. Two things clear a remembered choice: the popup's **Use template settings** button, and saving a changed engine or location in the template editor.

The decisions behind it (Q52 to Q54, Q61, Q62) and the task list are in [`implementation_plan.md`](./implementation_plan.md). The product is described in [`product.md`](../obsidian-inference-machine/product.md). This replaces requirement 19.0.3, which remembered one location for every template.

## What Was Implemented

### 1. Remembered state (TASK-1 to TASK-4)
- **`core/schema.ts`**: `UiState` keeps `lastTemplateId` and gains `templateChoices`, a map from template id to `TemplateChoices` (`engineId?`, `location?`). The old `lastLocation` field is gone.
  - It was removed in TASK-8, when the popup stopped reading it, rather than in TASK-1 as planned.
  - Removing it first would have left commits that don't build.
- **`core/ui-state.ts`** (new), pure helpers used inside `SettingsStore.update`:
  - `rememberChoice` saves one choice for a template.
  - `forgetChoices` removes the named choices, and tidies away an entry or map left empty.
  - `hasChoices` says whether a template has anything remembered.
  - `pruneChoices` forgets entries for deleted templates, a deleted engine's id, and a last template that was deleted.
  - `changedChoiceFields` names which of a template's engine and location differ between two versions of it. It wasn't in the plan as a separate function. It came out of TASK-6, so that rule could be unit-tested.
- **`core/data-validation.ts`**: `fillUiState` reads `templateChoices`, keeping a string engine id and a location that passes `checkLocation`, and silently forgets anything else. It no longer reads `lastLocation`, so an existing remembered location is dropped on the next save.
- **`obsidian/settings-store.ts`**: remembered choices are pruned when `data.json` loads and after every `update`. Deleting a template or an engine anywhere, including through an import that replaces templates, forgets what was remembered for it.

### 2. Runs, templates and the popup (TASK-5 to TASK-8)
- **`run/run-controller.ts`**: a finished run still sets `lastTemplateId`, so running a template picked by a command or trigger makes it the last one used. It no longer saves a location.
- **`ui/template-editor.ts`** (Q61): saving a template whose engine or location changed forgets what the popup remembered for that field of that template, in the same save.
- **`ui/derive-modal.ts`**:
  - **Restoring:** the popup's engine and location come from the current template's remembered choices, whichever way the template was picked (command, trigger, last used, or the dropdown).
  - **Saving:** each change is saved the moment it's made: the template, the engine, the location choice, and the folder path as you type.
  - **Refused folder paths:** a folder path the previous spec refuses (one with `..`) is kept only while it's shown, and is never remembered.
  - **The old shared location is gone:** nothing applies `lastLocation` to every template any more.
  - **Reset button (Q62):** **Use template settings** appears under the engine row whenever the current template has a remembered engine or location. It forgets both and shows the template's own settings.
  - **Build order:** TASK-8 was built before TASK-7, because the button relies on the new way choices are read.

### 3. Documentation (TASK-9)
- **`README.md`**: **Getting started** now says what the popup remembers and when, that a remembered choice beats the template's own setting, and the two ways to clear it.

## Verification & Test Results

### Automated Tests
Ran the Vitest suite (`npm test`), which enforces the coverage thresholds: **25 files, 396 tests passed**. Of these, 16 tests are new, and 4 existing tests were updated for the new state shape. Line coverage is 100% for `ui-state.ts`, `data-validation.ts` and `settings-store.ts`.
- `ui-state.ts`:
  - Remembering creates and updates per-template entries without touching other templates.
  - Forgetting removes one field, then the emptied entry and map.
  - `hasChoices` is true only for a remembered engine or location.
  - Pruning drops deleted templates, deleted engines and a deleted last template.
  - `changedChoiceFields` names exactly the fields that changed, including a change back to inherit.

  **Passed**
- Loading:
  - `fillUiState` keeps valid choices and drops a non-string engine id, an invalid location, a `..` subfolder and non-object entries.
  - It forgets the old `lastLocation`.
  - `normalizePluginData` prunes choices for templates and engines that don't exist.

  **Passed**
- Store: deleting an engine, then a template, through `update` forgets what was remembered for each. **Passed**
- Run controller: a run remembers only `lastTemplateId`. **Passed**
- End to end (new `test/e2e/specs/remember.e2e.ts`), in real Obsidian, latest and earliest supported versions:
  1. **Restored without a run:** the template and its folder are restored after closing the popup without running.
  2. **Kept apart:** with a second engine added, **Action items**' engine and folder aren't applied to **Comprehensive summary**, and come back when switching back.
  3. **Reset button:** **Use template settings** appears only once something is remembered, and clicking it restores the template's location and clears the stored choices.
  4. **Template editor:** changing **Action items**' location to the folder `Tasks` replaces the remembered `Out`.
  5. **Triggers:** a matching trigger picks its template, with that template's own location, and opening on the trigger's note doesn't change the remembered template.

  **Passed**

The old run-based 19.3 end-to-end scenario was removed, as planned. The new scenarios cover remembering without a run, and the run case is unit-tested.

### Regression Testing
- **End to end:** the full suite ran in real Obsidian, and **all 12 spec files passed**. That covers the desktop popup flows on the latest and earliest Obsidian, triggers, the new remembering scenarios, and mobile emulation. It includes the previous spec's folder-next-to-the-source scenario and the template-editor carry-over scenario.
- **Mid-way check:** after TASK-8, the existing 20 popup scenarios were run on their own, and all passed.
- **Lint and build:** `eslint .` and the production build pass.

## Manual Verification

Steps 1 to 8 below are now automated, in `test/e2e/specs/remember-restart.e2e.ts`, on the latest and earliest supported Obsidian. Both scenarios pass:
- **Steps 1 to 7:** two engines, the **Derive with** command, a real restart of Obsidian, and deleting an engine with its Delete control in settings.
- **Step 8:** a 0.3.0 `data.json` with a remembered location, loaded by restarting Obsidian.

The restart scenarios have their own spec file, which never calls `resetVault`. The test vault has no config folder, so `resetVault` deletes the running vault's, the plugin's `data.json` included. The plugin carries on from memory, so the other specs aren't affected, but a restart would load no data.

What the automation can't stand in for:
- **A real model:** both engines point at the mock server.
- **Picking the command from the palette:** the test runs the command by id.

The steps stay here for checking by hand:

1. With two engines set up (for example, a remote one and LM Studio), open the popup on any note and choose **Comprehensive summary**. Set **Engine** to LM Studio and **Output location** to **In a folder** `Summaries`. Press Esc without running.
2. Open the popup again. Expect **Comprehensive summary**, LM Studio, `Summaries`, and a **Use template settings** button.
3. Switch the template to **Key points / TL;DR**. Expect the default engine and its own location, and no **Use template settings** button.
4. Switch back to **Comprehensive summary** and click **Use template settings**. Expect the default engine and location, and the button gone.
5. Set LM Studio for **Comprehensive summary** again, close the popup, and run **Inference Machine: Derive with Comprehensive summary** from the command palette. Expect the popup on that template with LM Studio.
6. Restart Obsidian and open the popup. Expect the same choices.
7. In **Settings → Inference Machine**, delete the LM Studio engine. Open the popup on **Comprehensive summary**. Expect the default engine, with no error, and no **Use template settings** button unless a location is also remembered.
8. After updating from 0.3.0: if you had changed the location in the popup before, expect each template to start from its own location the first time.

## Follow-ups
- Every keystroke in a popup folder field writes `data.json`, as the plugin's own settings fields already do. If that turns out to be noticeable on slow sync setups, the popup could save on blur or after a short pause.
- Next spec: `derive-from-selection`, the right-click menu item, submenu and command for running a template on selected text.
