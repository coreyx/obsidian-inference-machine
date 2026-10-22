# Walkthrough: Carry images and frontmatter from the source

A derived note now carries over the images at the front of its source note and the source's frontmatter properties. The images go at the top of the new note, relinked so they still show from its folder. Both settings are on by default and set globally, and each template can turn either one off. Flashcards and the example templates come with one or both turned off.

The decisions behind it (Q40 to Q51) and the task list are in [`implementation_plan.md`](./implementation_plan.md). The product is described in [`product.md`](../obsidian-inference-machine/product.md).

## What Was Implemented

### 1. Settings (TASK-1 to TASK-4)
- **`core/schema.ts`, `core/defaults.ts`**: global `carryImages`, `carryProperties` and `excludedProperties`, on by default, with `aliases` and `cssclasses` excluded. Templates get optional `carryImages` and `carryProperties` overrides.
- **`core/data-validation.ts`**: older data files load with the defaults. Templates are checked for the two new fields like the other optional switches. An invalid exclude list falls back to the default, and a bad entry is dropped, each with a warning.
- **`core/resolve.ts`**: each run resolves both switches from the template first, then the global settings. The exclude list comes from the global settings only.

### 2. Leading images (TASK-5 to TASK-9)
- **`core/leading-images.ts`** (new):
  - `findLeadingImages` reads the image embeds before a note's first content, skipping headings and blank lines.
  - It reads `![[x.png|300]]` embeds of Obsidian's image formats, and `![alt](path or URL)` embeds of image files or `http(s)` URLs.
  - Note embeds and HTML `<img>` tags aren't images here.
  - `alreadyEmbedded` tells when the output already shows an image, so it isn't added twice.
- **`obsidian/links.ts`**: `imageEmbed` resolves a vault image and writes its embed with the vault's link settings for the output path. This is the same way the link back to the source is written. A size or caption is kept as the link's display text. URLs and links to missing files are kept exactly as written.
- **`core/compose.ts`, `core/output.ts`**: the composed note lists its leading images. `assemble({ link, images })` puts the relinked embeds at the top, followed by a blank line.
- **`run/run-controller.ts`**: once the output path is planned, the controller relinks each image for that path. The preview still shows exactly the text that gets saved.

### 3. Source frontmatter (TASK-10, TASK-11)
- **`core/compose.ts`**: `copiedProperties` takes every source property except these:
  - `tags` and `tag`, which tag merging already handles.
  - The excluded names, matched case-insensitively.

  A YAML date that was parsed as a `Date` is written back as `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when it has a time, not as a timestamp.
- **`core/output.ts`**: `assembleNote` adds the source's properties as a third layer, under the template's properties and the model's frontmatter. Empty ones are left out when the template leaves out empty properties.

### 4. Settings UI (TASK-12, TASK-13)
- **`ui/settings-tab.ts`**: a new **Carry over from the source** group with:
  - **Carry leading images**.
  - **Copy the source's frontmatter**.
  - **Properties not to copy**, a comma-separated list that's shown only while copying is on.
- **`ui/template-editor.ts`**: the two switches, each with **Inherit**, **On** and **Off**.

### 5. Built-in and example templates (TASK-14, TASK-15)
- **`core/builtins/index.ts`**:
  - Action items (now version 3) doesn't carry images.
  - Flashcards (now version 2) carries neither images nor properties.
  - Unedited copies of both update when the plugin loads.
- **`examples/*.json`**: Recipe card, Book reference and Movie reference don't copy properties, but they still carry a leading photo, cover or poster.

### 6. Tests and docs (TASK-16 to TASK-18)
- **Unit tests** for every new function. The test vault (`test/fake-app.ts`) now resolves links and can write relative Markdown links.
- **End-to-end scenarios:** a real image and properties carried into another folder, the template editor's new switches, and the new settings group.
- **README and CHANGELOG:** a README section on both settings, the built-ins' defaults, the exclude list and the trigger side effect, plus a CHANGELOG entry under Unreleased.

**Small departures from the plan:**
- **`sourceProperties` is optional** on `assembleNote`'s input instead of required, so callers that copy nothing can leave it out.
- **One test-only addition:** the test vault gained link resolution and a Markdown link style, which `imageEmbed`'s tests needed.

## Verification & Test Results

### Automated Tests
- **Unit tests** (`npm test`): **Passed**.
  - 365 tests in 23 files.
  - Coverage is 99.1% of statements, 95.6% of branches and 99.3% of lines overall. `leading-images.ts` and `links.ts` are fully covered.
  - The coverage run found two uncovered branches, which I fixed:
    - An unreachable fallback in `leading-images.ts`, which I simplified away.
    - The case where Obsidian already returns an embed, which now has a test.
- **End-to-end tests** (`npm run test:e2e`, in the Linux container as CI runs them): **Passed**, 12 of 12 spec files on Obsidian 1.14.4 and 1.13.4 and under mobile emulation.
  - The new scenario derives `Reading/Dune.md` into `Summaries/`. It checks that the saved note starts with `![[cover.png|200]]`, has `author` and `status` but not `aliases`, and leaves out the image below the first paragraph. It also checks that Obsidian resolves the carried embed to `Attachments/cover.png`.
  - The first run of the template editor test failed because of how the test read a value (`undefined` arrives as `null` from the browser), not because of the plugin. I changed the test to check whether the field is set.
- **One-off Markdown-link check**: **Passed**. I ran an extra spec from the scratchpad, not committed to the repo. It switched the vault to relative Markdown links and derived a note whose image is `![Cover|200](../Attachments/my%20cover.png)` into `Summaries/Deep/`. Obsidian resolved the relinked embed to `Attachments/my cover.png`.
- **Lint** (`npm run lint`): **Passed**, with only the existing warning about `fetch` in `engines/transport.ts`.
- **Build** (`npm run build`): **Passed**.

### Regression Testing
The unit suite ran after every task, and the desktop end-to-end spec after each UI task. Tests whose source note has properties now expect them to be copied: the default run in `run-controller.test.ts` expects `author: Ada`. I updated those expectations. Everything else passed unchanged.

## Manual Verification

This isn't in a release yet, so try it in the demo vault with `npm run demo`. After the next release, you can also update with BRAT and use your own vault.

1. In **Settings → Inference Machine**, find **Carry over from the source**. Check that **Carry leading images** and **Copy the source's frontmatter** are on, and that **Properties not to copy** shows `aliases, cssclasses`.
2. Take a note in a folder such as `Reading/` that has a few properties, such as `author`, `status` and `aliases`. It should start with an image from your attachments folder, such as `![[cover.jpg]]`, under its title.
3. Open Inference Machine on that note. Choose **Comprehensive summary**, set the location to another folder, and click **Run**. Expect:
   - The preview starts with the image, linked in your vault's link style.
   - The frontmatter has `author` and `status` but not `aliases`, and `created` is today.
4. Save, and open the new note in Reading view. Check that the image shows.
5. Run **Flashcards** on the same note. Expect no image and none of the source's properties, only `tags` and `created`.
6. Under **Templates**, click **Edit** on **Key points / TL;DR**. Set **Carry leading images** to **Off**, click **Save**, and run it on the note. Expect no image, and the properties still copied.
7. Turn **Copy the source's frontmatter** off and run **Comprehensive summary** again. Expect only `created` and tags in the frontmatter. Turn it back on.
8. Run a template on a note that starts with text and has an image further down. Expect no image at the top of the new note.

## Follow-ups

- **Side effect on triggers:** copied properties make derived notes match the same property triggers as their source. This is documented in the README, and adding the property to **Properties not to copy** avoids it.
- **Imported examples:** examples imported before this change keep copying properties until they're imported again.
- **Release:** this ships in the next release, through `prepare-release`.
