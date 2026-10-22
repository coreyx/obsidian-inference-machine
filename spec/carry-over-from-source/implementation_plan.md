---
status: approved
---

# Carry the source note's leading images and frontmatter into derived notes

A derived note can now carry over two things from its source: the images at the front of the source note, placed at the top of the new note with links that still work from its folder, and the source's frontmatter properties. Both are on by default, set globally, and can be turned off per template. Flashcards and the example templates come with one or both turned off.

**Related documents**
- [Product](../obsidian-inference-machine/product.md)

## User Review Required

> [!IMPORTANT]
> Both settings are on by default, so existing users' notes change after an update. Every template that doesn't turn a setting off starts copying the source's properties and leading images. That includes templates you wrote yourself. Turn either setting off globally to keep the old behavior.

> [!IMPORTANT]
> Built-in defaults:
> - Action items doesn't carry images.
> - Flashcards carries neither images nor properties.
> - The Recipe card, Book reference and Movie reference examples don't copy properties.
>
> Action items and Flashcards get a version bump, so unedited copies update. Examples that were already imported keep their old settings until they're imported again.

> [!NOTE]
> Copied properties make derived notes match the same property triggers as their source. For example, a Key points note made from a `type: book` note also gets `type: book`, so opening Inference Machine's window on it preselects a template whose trigger is `property:type=book`. Adding `type` to the exclude list avoids this.

> [!NOTE]
> - **Image files:** images are linked, not copied. The image file stays where it is, and only the embed is written into the new note.
> - **Properties and the model:** properties are copied as data. The model sees them as it does today, as part of the note's contents, and they aren't sent anywhere new.

## Open Questions

None at this time. The decisions behind this plan are Q40 to Q51:

- **Leading images:** every image before the note's first text, skipping headings and blank lines (Q40 C). All of them are carried (Q41 A), as `![[…]]` and `![…](…)` embeds, not HTML (Q42). They go at the top of the body (Q43 A).
- **Image setting:** global, with a per-template override (Q44 A).
- **Image links:** internal image links are rewritten for the new note's location, and external URLs are kept (Q45). An image the output already embeds isn't added twice (Q46).
- **Properties:** every property except `tags` is copied, minus a global exclude list that defaults to `aliases` and `cssclasses` (Q47 A).
- **Precedence:** template properties win, then the output's own frontmatter, then the source's (Q48).
- **Property setting:** global on/off with a per-template override, and the exclude list is global only (Q49 A).
- **Empty properties:** **Leave out empty properties** applies to copied properties too (Q50).
- **Template defaults:** as listed under User Review Required (Q51 A).

## Proposed Changes

### Settings model

#### [MODIFY] `src/core/schema.ts`
- [x] **TASK-1:** Add the two settings to the data model.
  - `GlobalSettings` gets `carryImages: boolean`, `carryProperties: boolean` and `excludedProperties: string[]`.
  - `Template` gets optional `carryImages?: boolean` and `carryProperties?: boolean`, each documented as inheriting the global value when left out.
  - `SCHEMA_VERSION` stays 1, because loading fills missing fields with their defaults (TASK-3).

#### [MODIFY] `src/core/defaults.ts`
- [x] **TASK-2:** Add the defaults.
  - `RunDefaults` and `DEFAULTS` get `carryImages: true`, `carryProperties: true` and `excludedProperties: ['aliases', 'cssclasses']`.
  - `defaultGlobalSettings()` copies them, with a fresh array for `excludedProperties`.

#### [MODIFY] `src/core/data-validation.ts`
- [x] **TASK-3:** Load and validate the new fields.
  - Add `carryImages` and `carryProperties` to `OPTIONAL_BOOLEAN_FIELDS`, so templates load and import them with the existing checks.
  - In the global settings loader, read `carryImages` and `carryProperties` as booleans, falling back to `DEFAULTS`.
  - Read `excludedProperties` as an array of non-empty trimmed strings. A missing or invalid value falls back to `DEFAULTS.excludedProperties`, and bad entries are dropped with a warning.

#### [MODIFY] `src/core/resolve.ts`
- [x] **TASK-4:** Resolve the new settings.
  - `RunConfig` gets `carryImages` and `carryProperties`, each resolved template, then global, then default, with their `sources` recorded like `openAfterCreate`.
  - It also gets `excludedProperties`, resolved global, then default.

### Leading images

#### [NEW] `src/core/leading-images.ts`
- [x] **TASK-5:** Add `findLeadingImages(body: string): LeadingImage[]`, which finds the images at the front of a note body (the body without frontmatter).
  - It reads lines from the top:
    - Blank lines and ATX headings are skipped.
    - A line made only of image embeds, separated by whitespace, adds each embed in order.
    - Any other line stops the scan: text, a list, a quote, a callout, a table or a code fence.
  - An image embed is either of these:
    - `![[target]]` or `![[target|size or caption]]`, where the target's extension is one of Obsidian's image formats: `avif`, `bmp`, `gif`, `jpeg`, `jpg`, `png`, `svg`, `webp`, case-insensitive.
    - `![alt](target)`, where the target is an `http://` or `https://` URL, or a vault path with one of those extensions. The target may be in angle brackets, and URL-encoded paths like `my%20photo.png` are decoded.
  - Not images: `![[Note]]` and `![](Note.md)` are note embeds. HTML `<img>` tags aren't read (Q42).
  - Each `LeadingImage` has `raw` (the text as written), `form` (`'wiki'` or `'markdown'`), `target` (the decoded path or URL, without any `#subpath`), `display` (the size or caption after `|`, or the alt text) and `external` (true for URLs).
- [x] **TASK-6:** Add `alreadyEmbedded(body: string, targets: string[]): boolean`, which reports whether the body already embeds any of the given targets.
  - It's used to skip an image the model's output already includes (Q46).
  - Targets match case-insensitively, by path or by filename alone, ignoring size, caption and `#subpath`, and only outside code blocks.

#### [MODIFY] `src/obsidian/links.ts`
- [x] **TASK-7:** Add `imageEmbed(app, source: TFile, image: LeadingImage, outputPath: string): { embed: string; targets: string[] }`, which writes an image's embed for the new note.
  - **External images** keep `raw` exactly as written.
  - **Internal images** are resolved with `app.metadataCache.getFirstLinkpathDest(image.target, source.path)`.
    - When the file is found, the embed is `!` plus `app.fileManager.generateMarkdownLink(file, outputPath, undefined, image.display)`. That follows the vault's link settings for the new location, and keeps the size or caption as the link's display text.
    - When no file matches, `raw` is kept as written (Q45).
  - `targets` holds the source's target and the resolved file's path, for `alreadyEmbedded`.

#### [MODIFY] `src/core/output.ts` and `src/core/compose.ts`
- [x] **TASK-8:** Put the carried images at the top of the note.
  - `AssembleInput` gets `leadingImages?: string[]`, the final embeds. `assembleNote` puts them, one per line, followed by a blank line, above the body, before the references link and `blankLineAfterHeadings` run.
  - `ComposedNote.assemble` takes `{ link?: string; images?: { embed: string; targets: string[] }[] }` instead of a bare link.
  - When `config.carryImages` is on, it passes the embeds whose targets the body doesn't already embed (`alreadyEmbedded`).
  - `ComposedNote` also exposes `leadingImages: LeadingImage[]`, found from `note.body` when `config.carryImages` is on, so the run controller can resolve them.

#### [MODIFY] `src/run/run-controller.ts`
- [x] **TASK-9:** Pass the images in.
  - After the output path is planned, map `composed.leadingImages` through `imageEmbed(app, source, image, path)`.
  - Then call `composed.assemble({ link, images })`.
  - The preview and the saved note both get the result, so the preview still shows exactly what will be saved.

### Source frontmatter

#### [MODIFY] `src/core/output.ts` and `src/core/compose.ts`
- [x] **TASK-10:** Copy the source's properties into the new note's frontmatter.
  - `AssembleInput` gets `sourceProperties: Record<string, unknown>`.
  - `assembleNote` adds them after the AI output's properties, and only those whose name isn't already set. Names match case-insensitively, as Obsidian matches property names. So template properties win, then the output's frontmatter, then the source (Q48).
  - Empty ones are then left out by the existing `omitEmptyProperties` step (Q50).
- [x] **TASK-11:** Add `copiedProperties(note: NoteSnapshot, excluded: string[]): Record<string, unknown>` in `compose.ts`.
  - It returns `note.properties` minus `tags` and `tag`, which go through the tag pipeline already, and minus every excluded name, matched case-insensitively.
  - A `Date` value is written back as `YYYY-MM-DD`, or as `YYYY-MM-DDTHH:mm` when it has a time, matching how `{{properties.x}}` and triggers already read dates. A YAML date then stays a date instead of becoming a timestamp.
  - Values are copied deeply, so the snapshot is never shared with the new note's data.
  - `composeNote` passes the result as `sourceProperties` when `config.carryProperties` is on, and `{}` otherwise.

### Settings and template editor UI

#### [MODIFY] `src/ui/settings-tab.ts`
- [x] **TASK-12:** Add a "Carry over from the source" group to the declarative settings, after "Output defaults", with three settings.
  - **Carry leading images:** a toggle on `carryImages`. Description: "Put the images at the front of the source note at the top of the new note. The images stay where they are; only the embeds are written."
  - **Copy the source's frontmatter:** a toggle on `carryProperties`. Description: "Copy the source note's properties into the new note. Tags are merged separately. A template's own properties take priority."
  - **Properties not to copy:** a text setting on `excludedProperties`, shown only when copying is on, written and read as a comma-separated list. Description: "Comma-separated property names." Clearing it saves an empty list, so every property is copied.
  - Wire up the keys in the getter and setter switch, the way `references.enabled` is.

#### [MODIFY] `src/ui/template-editor.ts`
- [x] **TASK-13:** Add two tri-state settings next to **Link back to the source**, using the existing `triState` helper with the inherited global value: **Carry leading images** (`carryImages`) and **Copy the source's frontmatter** (`carryProperties`).

### Built-in and example templates

#### [MODIFY] `src/core/builtins/index.ts`
- [x] **TASK-14:** Set the Q51 defaults on the built-ins.
  - Action items gets `carryImages: false`, version 2 to 3.
  - Flashcards gets `carryImages: false` and `carryProperties: false`, version 1 to 2.
  - The other three built-ins leave both unset, so they follow the global setting.

#### [MODIFY] `examples/recipe-card.json`, `examples/book-reference.json`, `examples/movie-reference.json`
- [x] **TASK-15:** Add `"carryProperties": false` to each example, and leave `carryImages` unset so a dish photo, book cover or film poster carries over.

### Tests

#### [MODIFY] `test/core/*.test.ts`, `test/run/run-controller.test.ts`, `test/e2e/specs/derive.e2e.ts`
- [x] **TASK-16:** Write unit tests in the project's Vitest suite, which enforces the coverage thresholds in `tasks.md` (see Verification Plan).
- [ ] **TASK-17:** Add an end-to-end scenario to `derive.e2e.ts`.
  - Write a small PNG into the test vault's `Attachments/` folder.
  - Write a source note that has properties, starts with `![[cover.png|200]]`, and has a markdown image below the first paragraph.
  - Derive it into another folder, save it, and check the saved note: it starts with a working embed of `cover.png` with `|200` kept, has no copy of the second image, and has the copied properties without `aliases`.

### Docs

#### [MODIFY] `README.md`, `CHANGELOG.md`
- [ ] **TASK-18:** Document both settings in the README's settings and template sections, including the trigger side effect and the exclude list. Add an Unreleased "Added" entry to the CHANGELOG.

## Verification Plan

### Automated Tests

This project tests with Vitest and enforces coverage thresholds, so the checks go in the existing suite (`npm test`) instead of a `scratch/` script. The end-to-end suite (`npm run test:e2e`) runs in CI and in the Linux container.

1. **`findLeadingImages`:**
   - It finds `![[a.png]]`, `![[a.png|300]]`, `![[Folder/a.png|A caption]]`, `![alt](a.png)`, `![](<my photo.png>)`, `![](my%20photo.png)` and `![](https://example.com/x)`, and several images on one line.
   - It skips blank lines and headings before them: `# Title`, then an image, then `## Intro`, then an image, then text gives both images.
   - It stops at the first text line, list, quote, callout, table or code fence.
   - It ignores `![[Note]]`, `![](Note.md)`, `<img>` and images after the first text.
   - It returns nothing for a note that starts with text.
2. **`alreadyEmbedded`:** it matches by full path and by filename, ignores size, caption, subpath and case, and ignores embeds inside code blocks.
3. **Assembling the note:**
   - Images come first, then a blank line, then the body.
   - An image already in the output isn't added twice.
   - Turning `carryImages` off adds nothing.
4. **Copying properties:**
   - Properties are copied with their values and types.
   - `tags`, `aliases` and `cssclasses` are left out, and custom excluded names are matched case-insensitively.
   - Template properties beat the output's frontmatter, which beats the source, so `created` stays the run date.
   - An empty copied property is left out when **Leave out empty properties** is on.
   - A `Date` becomes `YYYY-MM-DD`.
   - Turning `carryProperties` off copies nothing.
5. **Resolution and loading:**
   - The template value overrides the global one, and a template that leaves it unset inherits it.
   - Old `data.json` files without the new fields load with the defaults.
   - An invalid `excludedProperties` falls back to the default with a warning.
   - Exported templates keep `carryImages` and `carryProperties`, and import checks them.
6. **Built-ins and examples:**
   - Action items and Flashcards have the Q51 values and new versions, and unedited copies upgrade.
   - The three examples import with `carryProperties: false`.
7. **Run controller:** with a fake vault, an internal image is relinked for an output in another folder, an unresolved one is kept as written, and an external URL is kept. The preview text equals the saved text.
8. **End to end:** the scenario in TASK-17, on Obsidian 1.14.4 and 1.13.4.

### Manual Verification

1. In **Settings → Inference Machine**, find the **Carry over from the source** group and check:
   - **Carry leading images** and **Copy the source's frontmatter** are on.
   - **Properties not to copy** shows `aliases, cssclasses`.
2. Take a note in a folder such as `Reading/` that has a few properties (for example `author`, `status` and `aliases`) and starts with an image from your attachments folder, such as `![[cover.jpg]]`. Open Inference Machine on it, choose **Comprehensive summary**, set **Location** to another folder, and click **Run**. Expect:
   - The preview starts with the image, shown as a link in your vault's link style.
   - The preview's frontmatter has `author` and `status` but not `aliases`, and `created` is today.
3. Save, open the new note in Reading view, and check that the image shows.
4. Run **Flashcards** on the same note. Expect no image and none of the source's properties, only `tags` and `created`.
5. Under **Templates**, click **Edit** on **Key points / TL;DR**, set **Carry leading images** to off, save, and run it on the note. Expect no image, and the properties still copied.
6. Turn **Copy the source's frontmatter** off globally and run **Comprehensive summary** again. Expect only `created` and tags in the frontmatter. Turn it back on.
7. Run a template on a note that starts with text and has an image further down. Expect no image at the top of the new note.

## Visual design application

The new settings use Obsidian's own settings components, as the existing settings do. No design system or art bible exists for this product, so there's nothing to apply.
