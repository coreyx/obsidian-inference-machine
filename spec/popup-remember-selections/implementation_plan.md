---
status: approved
---

# Remember the popup's choices, per template, as soon as they change

The Inference Machine popup remembers your choices the moment you make them, even if you close it without running. The last template is remembered for the whole vault. The engine and output location are remembered for each template, so a template set to a local engine for privacy is never switched to a remote one by a choice made for another template. Template commands and triggers still pick the template before the remembered one does.

**Related documents**
- [Product](../obsidian-inference-machine/product.md)

## User Review Required

> [!IMPORTANT]
> **The output location stops being remembered for every template at once.** Today the last location chosen in the popup is used for every template, and it beats a template's own location. After this change, each template remembers its own engine and location. The old remembered location is forgotten when the plugin loads, so on first open each template shows its own settings, or the global defaults, until you change them in the popup.

> [!IMPORTANT]
> **A remembered choice beats the template's own setting, until something clears it.** If you pick **LM Studio** for **Comprehensive summary** in the popup, that template keeps using LM Studio even after you set another engine in the template editor. Saving a changed engine or location in the template editor clears it (TASK-6, Q61), and so does the popup's **Use template settings** button (TASK-7, Q62).

> [!NOTE]
> This replaces requirement 19.0.3 ("remember the last-used template and output location between runs"). [`requirements.md`](../obsidian-inference-machine/requirements.md) is approved, so it isn't edited. This plan and its walkthrough record the change.

> [!NOTE]
> - **Triggers and commands:** the order for picking the template is unchanged (22.0.3, Q54): a template command, then a matching trigger, then the remembered template, then the first one.
> - **Remembered template:** a template picked by a trigger or a command is remembered only if you change it in the popup or run it. Merely opening the popup on a note with a trigger doesn't change the remembered template.
> - **Engine and location:** these are restored for whichever template is picked, however it was picked.

## Open Questions

None at this time. The decisions behind this plan are Q52 to Q54, Q61 and Q62:

- **Save on change (Q52 A):** choices are saved the moment they change, even if the popup is closed without running.
- **What's remembered, and where (Q53 A):** the template is remembered for the whole vault, and the engine and location for each template.
- **Commands and triggers still win (Q54 A):** a template command or a matching trigger picks the template before the remembered one does.
- **The template editor clears remembered choices (Q61 A):** saving a template with a changed **Engine** or **Location** forgets what was remembered for that field of that template (TASK-6).
- **Reset button (Q62 A):** the popup shows **Use template settings** when the current template has a remembered engine or location (TASK-7).

## Proposed Changes

### State model

#### [MODIFY] `src/core/schema.ts`
- [x] **TASK-1:** Change `UiState` to remember the engine and location per template.
  - `lastTemplateId?: string` stays.
  - Remove `lastLocation`.
  - Add `templateChoices?: Record<string, TemplateChoices>`, keyed by template id.
  - The new exported type `TemplateChoices` holds `engineId?: string` and `location?: OutputLocation`.
  - Document each: what it holds, and that a missing field means "use the template's setting".

#### [NEW] `src/core/ui-state.ts`
- [x] **TASK-2:** Add pure helpers for the remembered state, with no Obsidian imports:
  - `rememberChoice(ui, templateId, field, value)`: sets `templateChoices[templateId][field]`, creating the entry when needed.
  - `forgetChoices(ui, templateId, fields)`: removes the named fields, and removes the template's entry once it's empty.
  - `pruneChoices(ui, templateIds, engineIds)`:
    - Drops entries for templates that no longer exist.
    - Drops a remembered `engineId` whose engine no longer exists.
    - Clears `lastTemplateId` when its template no longer exists.

#### [MODIFY] `src/core/data-validation.ts`
- [x] **TASK-3:** Update `fillUiState` for the new shape.
  - Read `templateChoices` as a record of records. Keep a string `engineId`, and a `location` that passes `checkLocation`.
  - Silently forget anything else, as popup state is today.
  - Don't read the old `lastLocation`, so it's dropped on the next save.

#### [MODIFY] `src/obsidian/settings-store.ts`
- [x] **TASK-4:** Tidy the remembered state against what exists.
  - After `fillUiState`, call `pruneChoices` with the loaded template and engine ids.
  - Call it again after every `update`, so deleting a template or an engine, in settings or through an import that replaces templates, also forgets what was remembered for it.

### Run controller

#### [MODIFY] `src/run/run-controller.ts`
- [x] **TASK-5:** Remember only the template at run time.
  - On a successful run, keep setting `ui.lastTemplateId`. Running a template picked by a command or trigger still makes it the last one used.
  - Stop writing `ui.lastLocation`. The popup now saves the engine and location as they change (TASK-8).

### Template editor

#### [MODIFY] `src/ui/template-editor.ts`
- [x] **TASK-6:** (Q61 A) In `save()`, compare the saved template's `engineId` and `location` with the stored copy. For each one that changed, call `forgetChoices` for that field of that template, in the same `store.update`.

### Popup

#### [MODIFY] `src/ui/derive-modal.ts`
- [ ] **TASK-7:** (Q62 A) Add a **Use template settings** button to the setup step.
  - It's shown only when the current template has a remembered engine or location.
  - Clicking it calls `forgetChoices` for both fields and re-renders the setup step.
- [ ] **TASK-8:** Restore and save choices as they change (Q52 A, Q53 A).
  - **Restoring.** Derive the popup's overrides from the current template's remembered choices, whenever the template changes and however it was chosen (prefill, trigger, command or the dropdown).
    - Replace the per-popup `engineOverride` and `locationOverride` with reads from `store.data.ui.templateChoices[templateId]`.
    - Keep a transient `typedLocation` only for a folder path that's currently refused, so the field keeps what was typed without saving it.
  - **Template dropdown:** a change saves `ui.lastTemplateId` at once.
  - **Engine dropdown:** a change saves `engineId` for the current template at once.
  - **Location:**
    - A change of the location dropdown saves `location` for the current template.
    - Typing a folder path saves on each edit while the path is valid, and a refused path isn't saved (from the previous spec).
    - Switching between the two folder choices still carries the path over.
  - **Removed:** the `prefill` rule that applied `ui.lastLocation` to every template, along with its exception for template commands.
  - **Saving:** each save goes through `store.update`, which already writes `data.json`. Changes happen at the speed of clicks and keystrokes, so no debounce is added.

### Documentation

#### [MODIFY] `README.md`
- [ ] **TASK-9:** Under **Getting started**, describe what the popup remembers:
  - The last template, for the whole vault.
  - Each template's engine and location.
  - That choices are remembered the moment they're made.
  - What **Use template settings** does.
  - That editing a template's engine or location in settings resets what was remembered for it.

### Tests

#### [NEW] `test/core/ui-state.test.ts`, [MODIFY] `test/core/data-validation.test.ts`, `test/obsidian/settings-store.test.ts`, `test/run/run-controller.test.ts`
- [ ] **TASK-10:** Unit tests for the cases listed under Automated Tests, items 1 to 4.

#### [MODIFY] `test/e2e/specs/derive.e2e.ts`
- [ ] **TASK-11:** Replace the 19.3 scenario with scenarios for:
  - Restoring without running.
  - Per-template memory.
  - **Use template settings**.
  - Clearing from the template editor.
  - Triggers still winning.

  The steps are listed under Automated Tests, item 5.

## Verification Plan

### Automated Tests

As before, the checks go in the Vitest suite (`npm test`) and the end-to-end suite (`npm run test:e2e`), not a `scratch/` script.

1. **`ui-state.ts`:**
   - `rememberChoice` creates and updates an entry.
   - `forgetChoices` removes one field, and removes the entry when it's empty.
   - `pruneChoices` drops a deleted template's entry and a deleted engine's id, and clears a `lastTemplateId` pointing at a deleted template.
2. **Loading:**
   - `fillUiState` keeps valid `templateChoices`.
   - It drops a bad engine id type, an invalid location and a `..` subfolder.
   - It forgets an old `lastLocation`.
   - `normalizePluginData` prunes choices for templates and engines that don't exist.
3. **Store:** deleting a template or an engine through `update` removes what was remembered for it.
4. **Run controller:**
   - A run sets `lastTemplateId` and writes no location.
   - The 19.3 unit test is updated to match.
5. **End to end, in real Obsidian:**
   1. Open the popup on `Alpha.md` and choose **Action items**. Set its location to **In a folder** `Out`, and close the popup without running. Reopen it, and expect **Action items** with `Out`.
   2. Switch to **Comprehensive summary**. Expect its own location (next to the source), not `Out`. Switch back to **Action items**, and expect `Out`.
   3. Click **Use template settings**. Expect **Action items**' own location, and the button gone.
   4. Set **Action items** to `Out` again. Edit the template, change its **Location** to **In a folder** `Tasks`, and save. Reopen the popup and expect `Tasks`.
   5. With **Action items** remembered, open the popup on a note matching another template's trigger. Expect the trigger's template, with that template's own location.

### Manual Verification

1. With two engines set up, such as a remote one and LM Studio, open the popup on any note and pick **Comprehensive summary**. Set **Engine** to LM Studio and **Output location** to **In a folder** `Summaries`. Close the popup with Esc, without running.
2. Open the popup again. Expect **Comprehensive summary**, LM Studio and `Summaries`.
3. Switch the template to **Key points / TL;DR**. Expect the default engine and its own location, not LM Studio or `Summaries`.
4. Switch back to **Comprehensive summary** and click **Use template settings**. Expect the default engine and location, and the button gone.
5. Run **Inference Machine: Derive with Comprehensive summary** from the command palette after setting LM Studio for it again. Expect the popup to open on that template with LM Studio.
6. Restart Obsidian and open the popup. Expect the same choices.
7. Delete an engine that a template remembered. Open the popup on that template, and expect its own engine, with no error.

## Visual design application

The new button uses Obsidian's own button component in the popup's existing setting rows. No design system or art bible exists for this product, so there's nothing to apply.
