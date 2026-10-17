---
status: approved
---

# Implementation Tasks: Obsidian Inference Machine

This document defines the implementation plan as a numbered checklist. Each task is linked to one or more acceptance criteria from [`requirements.md`](./requirements.md), and follows [`design.md`](./design.md) and [`tech.md`](./tech.md).

**Coverage targets** (Vitest + `@vitest/coverage-v8`, enforced in `npm test`):

| Code | Line coverage | Branch coverage |
|---|---|---|
| `src/core/tags/`, `src/core/resolve.ts`, `src/core/output.ts`, `src/core/inline.ts` | ≥ 95% | ≥ 90% |
| Rest of `src/core/` and `src/engines/` | ≥ 85% | ≥ 75% |
| Overall | ≥ 75% | — |

UI modules are covered by end-to-end tests (TASK-21) rather than unit thresholds.

**Ordering:** milestones are done in order, and each ends with a "Done when" check. Task numbers are global and stay stable, so commits and tests can cite them.

| Milestone | Tasks | Depends on |
|---|---|---|
| 1. Foundation | TASK-1 to TASK-3 | — |
| 2. Core logic | TASK-4 to TASK-8 (any order) | Milestone 1 |
| 3. Engines | TASK-9 to TASK-11 | TASK-1 only, so it can run alongside Milestone 2 |
| 4. Headless run | TASK-12 to TASK-15 | Milestones 2 and 3 |
| 5. User interface | TASK-16 to TASK-19 | Milestone 4 |
| 6. Mobile, end-to-end tests and release | TASK-20 to TASK-23 | Milestone 5 |

Dependencies within a milestone are noted per task.

## Task List

### Milestone 1: Foundation

**Done when:** The plugin builds, loads in a test vault, and loads and resolves settings.

- [x] **TASK-1: Project scaffold and tooling**
  - **Associated Acceptance Criteria**: *infrastructure, no direct criterion.* Enables the mobile constraint behind `17.1`.
  - **Concrete Steps**:
    1. Initialize from the obsidian-sample-plugin layout:
       - `package.json`, `tsconfig.json`, `esbuild.config.mjs` (externals as in tech.md), `manifest.json` (`id: inference-machine`, `minAppVersion: 1.11.4`, `isDesktopOnly: false`), `versions.json`, `styles.css`
       - `npm run dev`, `build`, `lint`, `test`
    2. Pin exact versions of `knap` and `@codemirror/lang-markdown`. Add the dev dependencies `obsidian`, `typescript`, `esbuild`, `eslint`, `eslint-plugin-obsidianmd`, `vitest`, `@vitest/coverage-v8` and `fast-check` (MIT, for property tests).
    3. Configure ESLint with `eslint-plugin-obsidianmd`. Add a `no-restricted-imports` rule that bans `obsidian` (and Node built-ins) under `src/core/`, and bans Node built-ins everywhere (REQ-17).
    4. Create the module layout from design.md, with an empty `onload`/`onunload`.
    5. Add a minimal `obsidian` test double (`test/obsidian-stub.ts`) aliased in `vitest.config.ts`. Configure the coverage thresholds above.
    6. Add a GitHub Actions workflow that runs lint, build and test on pushes and pull requests. Add a `.gitignore` for `node_modules/`, `main.js` and coverage output.
    7. Verify: `npm run build` produces `main.js`, the plugin loads in a test vault on desktop, and `npm test` passes with zero tests.

- [x] **TASK-2: Data model, defaults and settings store**
  - **Associated Acceptance Criteria**: `5.2` (the defaults half; resolution in TASK-3)
  - **Concrete Steps**:
    1. Implement `src/core/schema.ts` with `PluginData`, `EngineConfig`, `Template`, `PropertyDef`, `TaggingSettings`, `TaggingOverrides`, `GlobalSettings` and `UiState`, exactly as in design.md's data model.
    2. Implement `DEFAULTS` with the built-in safe defaults from 5.0.4, Q17 and design.md:
       - next to source
       - `{{title}} - {{template}}`
       - merge source tags on
       - AI tagging off
       - kebab-case
       - prefixes on
       - reuse vault tags on
       - 3–7 tags
       - preview on
       - references on, `# References`
       - open after create on
       - collision `number`
       - LM Studio port 1234
    3. Implement `src/obsidian/settings-store.ts`: load `data.json`, apply migrations keyed by `schemaVersion`, fill missing fields from `DEFAULTS`, save. Reject unknown provider types.
    4. Unit tests: an empty data file loads to defaults, partial data keeps the user's values, and a migration from an older `schemaVersion` runs once.

- [x] **TASK-3: Settings resolution**
  - **Associated Acceptance Criteria**: `3.2`, `3.3`, `3.5`, `5.2`, `5.3`
  - **Concrete Steps**:
    1. Implement `resolveRunConfig` in `src/core/resolve.ts`. It layers popup overrides, then the template, then global settings, then `DEFAULTS`, field by field, and records each field's source layer.
    2. Resolve the engine:
       - popup override, else the template's `engineId`, else `defaultEngineId`
       - when the template's engine is missing, fall back to the default and return a notice naming it (3.0.7)
       - return "no engine" when none exist
    3. Merge tagging settings field by field. `preferredTags` comes only from the template.
    4. Unit tests:
       - every layer combination for representative fields
       - the default engine is chosen for a template without one (3.2)
       - a popup override doesn't change the template or global settings (3.3)
       - a missing engine falls back with a notice (3.5)
       - a global folder applies unless the template sets one (5.3)
       - a template with only a name and prompt resolves fully (5.2)

### Milestone 2: Core logic

**Done when:** Every pure rule (tags, templates, output, inline prompts, size estimate) is implemented and unit-tested to the coverage targets.

- [x] **TASK-4: Tag pipeline (core)**
  - **Associated Acceptance Criteria**: `11.1`, `11.2`, `11.3`, `12.1`, `12.2`, `12.3`, `12.4`, `12.5`, `13.1`, `13.2`, `13.4`, `13.5`, `13.6`, `14.2`, `14.3`, `14.5`
  - **Concrete Steps**:
    1. `normalize.ts`: `tagKey()` as in design decision 7, splitting on `/ - _`, whitespace and lower-to-upper case boundaries, with digit runs kept attached to their letters.
    2. `format.ts`: per-segment conversion to kebab, snake, camel and Pascal, keeping `/`. Custom formats are not converted.
    3. `validate.ts`:
       - replace spaces with the format's separator (`-` for custom)
       - strip characters other than Unicode letters, digits, marks, emoji, `_`, `-` and `/`
       - collapse repeated separators, and trim them and slashes from both ends
       - drop empty or all-digit tags, recording each with a reason
    4. `pipeline.ts`: `buildTags()` running the seven steps in design.md:
       - collect
       - prepare AI tags (existing-only, flatten, format or vault spelling)
       - optionally format source tags
       - validate
       - dedup by key with precedence
       - order
       - cap AI tags at `maxTags`
    5. Example tests for every listed criterion, using the exact inputs in requirements.md.
    6. **Property-based tests (`fast-check`) for 12.5.** For random mixes of source, template and AI tags in all formats and cases, check that:
       - no two output tags share a key
       - every source tag's key is present when merging is on
       - every output tag is valid
       - the number of AI-contributed tags never exceeds `maxTags`
    7. Meet the ≥ 95% line / ≥ 90% branch target for `src/core/tags/`.

- [x] **TASK-5: Template engine adapter, variables and main prompt**
  - **Associated Acceptance Criteria**: `5.4`, `5.5`, `6.1`, `6.2`, `6.3`, `6.4`, `7.1`, `7.2`, `7.3`, `7.4`, `21.7`
  - **Concrete Steps**:
    1. `src/core/template/knap.ts` is the only `knap` import.
       - `render(tpl, vars, prompts?)` uses `createEngine({ filters: standardFilters })` and an async `resolveVariable` for prompt variables.
       - `validate` is used for syntax and filter errors.
       - `diagnose(tpl, where)` walks the AST and reports unknown variable names against our catalog, and prompt variables in `prompt` or `context` fields (21.0.7).
    2. `variables.ts` builds the variable map from a `NoteSnapshot`, using the table in design.md: `title`, `content`, `body`, `frontmatter`, `properties.*`, `path`, `folder`, `created`, `modified`, `date`, `time`, `template`, `output`. A missing key resolves to empty (6.3).
    3. `prompt.ts`: `buildMainPrompt()` appends the filename and full contents when the rendered prompt contains neither `{{content}}` nor `{{body}}` (5.0.5).
    4. When a filter fails at run time, leave the value unfiltered and return a notice naming the filter (7.0.3).
    5. Tests:
       - each variable, including `properties["key with spaces"]`
       - `{{missing|default:"n/a"}}`
       - chained filters
       - an unknown filter gives a notice and no failure
       - unknown-variable and misplaced-prompt diagnostics
       - auto-append (5.4)
       - the default filename `Alpha - Summary` (5.5)
    6. **Filter parity (7.1):** run each first-release filter against a fixture set taken from `knap`'s compatibility fixtures, pinned to the installed `knap` version.

- [x] **TASK-6: Output assembly and filenames (core)**
  - **Associated Acceptance Criteria**: `8.3`, `8.6`, `8.7`, `10.3`, `10.5`, `10.6`, `10.7`, `15.8`
  - **Concrete Steps**:
    1. `stripEnclosingFence()` removes a fence only when the whole trimmed response is a single fenced block.
    2. `splitLeadingFrontmatter()` parses a leading `---` block as YAML (via a parser injected from the adapter layer) and returns its data and the remaining body.
    3. Property rendering and typing:
       - `multitext` is split on `, ` as Web Clipper does
       - `number`, `checkbox`, `date` and `datetime` are coerced, and fall back to text when invalid
       - `omitEmptyProperties` is honored
       - AI-frontmatter properties are merged under template properties, and AI-frontmatter `tags` are handed to the tag pipeline as AI tags
    4. Add the references section:
       - find the heading as a whole line, ignoring trailing spaces, outside code fences
       - append `- <link>` at the end of that heading's section
       - otherwise append the heading and link at the end of the note
    5. `assembleNote()` produces the final text: YAML frontmatter, via an injected `stringifyYaml`, plus the body.
    6. `filename.ts`: remove `\ / : * ? " < > |` and leading dots, trim, fall back to `Untitled`. `numbered(name, n)` produces `Name 1`.
    7. Tests:
       - one test per listed criterion
       - fences that should *not* be stripped (a response with text around a fence)
       - a heading inside a code block is ignored
       - `## Sources` custom heading (10.7)

- [x] **TASK-7: Inline prompts (core)**
  - **Associated Acceptance Criteria**: `21.1`, `21.2`, `21.3`, `21.5`, `21.6`
  - **Concrete Steps**:
    1. `collectPrompts(tpls)` returns the prompt texts from the filename, property and body templates, in order, with duplicates removed.
    2. `buildInlineRequest(context, prompts)`: a system instruction asking for one JSON object `{"prompts_responses":{"prompt_1":…}}`, plus the rendered context and the numbered prompts.
    3. `parseInlineResponse(raw, n)`:
       - extract the first JSON object
       - repair common escaping problems
       - fall back to matching each key individually
       - return `undefined` for missing answers
    4. Render with the answers, so filters apply to responses (21.3). Missing answers resolve to empty and are listed for a notice (21.6).
    5. Tests:
       - one request for three prompts (21.2)
       - the `description` property is filled (21.1)
       - a custom context of `{{body}}` excludes the frontmatter (21.5)
       - a parser corpus of malformed responses: trailing text, unescaped quotes and newlines, code-fenced JSON, missing keys

- [x] **TASK-8: Token estimate (core)**
  - **Associated Acceptance Criteria**: `16.1` (the estimate half; the modal is in TASK-16)
  - **Concrete Steps**:
    1. `estimateTokens(text) = ceil(chars / 3.5)`.
    2. `checkFits(requestText, contextWindow, maxOutputTokens)` returns `{fits, estimate, limit}`, or `unknown` when the context window is unset (16.0.4).
    3. Tests at, just under and just over the limit, and with an unset context window.

### Milestone 3: Engines

**Done when:** All four engine types and LM Studio detection pass their fixture tests.

- [x] **TASK-9: Engine transport, SSE parsing and errors**
  - **Associated Acceptance Criteria**: `3.4`, `8.5`, `18.2`
  - **Concrete Steps**:
    1. `sse.ts`: an incremental server-sent-events parser that handles split chunks, multi-line `data:` lines, comments and `[DONE]`.
    2. `transport.ts`:
       - `fetchStream()` uses `fetch`, a `ReadableStream` and an `AbortSignal`
       - `requestJson()` uses `requestUrl`
       - CORS fallback: a `TypeError` before any response triggers one retry through `requestUrl`, adds the engine to `streamingBlocked`, and reports a one-time `cors` hint (design decision 6)
       - an HTTP error never falls back
    3. `NormalizedError` covers 401/403 → `auth`, 429 → `rate-limit`, 404 → `not-found`, context-length errors, network failures and empty responses, each with a plain-language message and hint.
    4. Redaction: every message is passed through `redact(message, secretValue)` before it leaves the engine layer (18.0.3).
    5. Tests:
       - SSE chunk-boundary cases
       - fallback taken on `TypeError` and not on HTTP 500
       - status-to-kind mapping
       - an auth error message is readable and contains no key (3.4, 18.2)

- [x] **TASK-10: Provider clients and model metadata**
  - **Associated Acceptance Criteria**: `3.1`, `3.7`, `3.8`
  - **Concrete Steps**:
    1. `anthropic.ts`, `openai.ts` (for both the `openai` and `openai-compatible` types) and `gemini.ts` implement `Engine` (`stream`, `complete` with `json`, `listModels`, `test`) per design.md's wire-format table. That covers:
       - headers
       - the max-output-tokens field each provider expects
       - truncation flags
       - JSON mode
    2. OpenAI-compatible engines send `Authorization: Bearer` only when a secret is set (3.0.10).
    3. `model-metadata.ts`: known context windows for current Anthropic and OpenAI model families by ID prefix. `listModels` returns reported windows where available (Gemini, LM Studio).
    4. Recorded-fixture tests per provider:
       - request bodies and headers
       - streaming deltas assembled
       - truncation detected
       - error bodies normalized
       - the Bearer header present or absent depending on the key (3.8)

- [x] **TASK-11: LM Studio detection**
  - **Associated Acceptance Criteria**: `3.7`, `4.1`, `4.2`, `4.3`, `4.4`, `4.5`, `4.6`
  - **Concrete Steps**:
    1. `lmstudio.ts` `detectLmStudio(port, token?)`:
       - probe `/api/v1/models`, then `/api/v0/models`, then `/v1/models`, using `requestUrl`
       - without a token first; send `Authorization: Bearer` when a token is given
       - map the results to `ok`, `unreachable`, `no-models` or `auth-required` (401/403)
       - read the loaded state and the loaded or maximum context length
    2. `ui/detect-flow.ts`:
       - **ok:** offer a model choice with the loaded model preselected when there's more than one (4.2), then upsert the engine matched by `lmStudio.port`, never duplicating (4.4). Base URL `http://localhost:<port>/v1`. Context window `reported` (3.7).
       - **unreachable:** "start LM Studio's server" message (4.3).
       - **no-models:** "load a model" message.
       - **auth-required:** token prompt using `SecretComponent` or a new secret, then retry. An invalid token shows the authentication message naming Developer → Server Settings → Manage Tokens (4.6).
    3. Fixture tests for each detector state and API-version fallback, including a 401 followed by success with a token (4.5).

### Milestone 4: Headless run

**Done when:** A full run (snapshot, requests, assembly, save) works through the run controller in tests, with built-ins and AI tagging.

- [x] **TASK-12: Obsidian adapters**
  - **Associated Acceptance Criteria**: `2.4`, `10.1`, `10.2`, `10.4`, `10.8`, `11.4`, `14.1`, `14.4`
  - **Depends on**: TASK-6
  - **Concrete Steps**:
    1. `note-reader.ts`: `readNote(app, file)` uses `vault.cachedRead` and `getFileCache`. Frontmatter tags come from `parseFrontMatterTags` (11.4) and inline tags from `cache.tags`. It also produces `getFrontMatterInfo` splitting, `ctime` and `mtime`. **Read-only. No write API is reachable from it** (2.4).
    2. `tag-index.ts`: `VaultTagIndex` with tag counts from `getAllTags` across Markdown files.
       - It's built lazily on first use and kept current on `metadataCache` `changed`/`deleted` events after that.
       - It provides `ranked(1000)`, `keys()` and `prefixes()` (every ancestor of a nested tag).
       - It's never built while AI tagging is off (14.1).
    3. `note-writer.ts`:
       - `planPath()` resolves the folder (the source's folder for "alongside"), sanitizes the name, and numbers it until free (10.4)
       - `ensureFolder()` creates every missing level (10.2)
       - `create(path, text)`
       - `open(file)` is skipped when `openAfterCreate` is off (10.8)
    4. `links.ts` wraps `fileManager.generateMarkdownLink`. `secrets.ts` wraps `app.secretStorage` get/set/list and supplies the secret value to redaction.
    5. Tests with the Obsidian test double:
       - folder creation
       - numbering
       - tags read as both string and list
       - the prefix list contains `ai/` for `ai/llm` (14.4)
       - the tag index isn't built when AI tagging is off

- [ ] **TASK-13: Built-in templates**
  - **Associated Acceptance Criteria**: `15.1`, `15.2`, `15.3`, `15.4`, `15.5`, `15.6`, `15.7`, `15.8`, `15.9`
  - **Depends on**: TASK-2, TASK-5, TASK-6
  - **Concrete Steps**:
    1. `src/core/builtins/reading-guidance.ts` holds the shared "Reading the source note" text (15.0.2).
    2. One definition per built-in, each with `origin.builtInId` and `version`, `omitEmptyProperties: true` and `created: {{date}}`:
       - **Comprehensive summary:** adapted from the YouTube summarizer's `DEFAULT_PROMPT`, without the transcription-error section.
       - **Key points / TL;DR.**
       - **Action items:** a `- [ ]` checklist with owner and due date when stated.
       - **Flashcards:** `Question::Answer`, and the template's `tags` property includes `flashcards`.
       - **Literature note:** `source`, `author` (`multitext`) and `published` (`date`) from `{{properties.*}}`.
    3. Built-in install and upgrade in the settings store:
       - seed the built-ins on first load
       - on load, replace a template with a newer built-in version only when its content hash still equals `origin.hash` (15.0.4)
       - add a "Restore built-in templates" action
       - duplicating removes `origin`
    4. Tests:
       - all five built-ins seeded (15.1)
       - each prompt contains the reading guidance (15.3)
       - duplicating keeps the original (15.4)
       - the upgrade replaces an unedited copy and keeps an edited one (15.5)
       - fixture-engine renders for Flashcards (15.6) and Literature note on a clipping and on a plain note (15.7, 15.8)
       - `created` on all built-ins (15.9)
       - Comprehensive summary from a recorded response contains its sections (15.2, automated half)

- [ ] **TASK-14: AI tagging request**
  - **Associated Acceptance Criteria**: `13.3`, `14.1`, `14.2`, `14.3`, `14.4`, `14.5`, `14.6`
  - **Depends on**: TASK-4, TASK-10, TASK-12
  - **Concrete Steps**:
    1. `src/core/tagging-request.ts` builds the tagging prompt from:
       - the source note
       - the vault tags (ranked, capped at 1,000) when reuse is on
       - the vault's prefixes when hierarchical prefixes are on (with the "reuse first, create only when none fits" instruction), or a flat-only instruction when off
       - the format instruction (a custom format's text verbatim, 13.3)
       - preferred tags
       - the min and max count
       - the existing-only instruction
    2. Parse the response as a JSON array, falling back to a comma- or newline-separated list, and pass the tags to `buildTags()` as AI tags.
    3. A failure gives no AI tags plus a notice (14.6). With AI tagging off, no request is sent and no tag list is built (14.1).
    4. Tests with a fixture engine:
       - prompt content for each setting
       - a response of 10 tags is capped (14.2)
       - an invented tag is dropped in existing-only mode (14.3)
       - `ai/` is present in the prompt (14.4)
       - nested tags are flattened when prefixes are off (14.5)
       - failure handling (14.6)

- [ ] **TASK-15: Run controller**
  - **Associated Acceptance Criteria**: `2.4`, `8.1`, `8.2`, `8.4`, `9.4`, `16.1`, `16.2`, `21.2`, `21.4`, `21.8`
  - **Depends on**: TASK-3 to TASK-14
  - **Concrete Steps**:
    1. `run/run-controller.ts` runs these steps:
       - snapshot the source
       - resolve the configuration
       - render the main prompt, prompt context and inline prompt list
       - estimate size for the main and inline requests, and ask the UI to confirm when either exceeds the limit (16.1, 16.2)
       - send the main, inline and tagging requests concurrently (design decision 4)
       - assemble the output
       - plan the path and generate the source link
       - return the preview text, warnings and the planned path
    2. Skip the main request when the template has no main prompt (21.4). Skip the inline request when there are no inline prompts (21.8). Send one inline request regardless of the prompt count (21.2).
    3. Cancellation: one `AbortController` plus a run token. Late results after cancel are dropped, and nothing is written (8.2).
    4. On main-request failure, return a `NormalizedError` and keep the input, so the user can retry (8.4).
    5. Save: re-check the planned path and regenerate the link if it changed. Create the note, then open it per settings. With `skipPreview`, save automatically on completion (9.4).
    6. Tests with fixture engines and the Obsidian test double:
       - the happy path
       - cancel at each stage leaves the vault unchanged
       - the source note's content and mtime are unchanged after success, failure and cancel (2.4)
       - partial failures
       - request-count assertions for 21.2, 21.4 and 21.8

### Milestone 5: User interface

**Done when:** A user can derive a note from the ribbon or a command, and manage engines and templates in settings.

- [ ] **TASK-16: Derive modal (popup)**
  - **Associated Acceptance Criteria**: `1.5`, `2.1`, `2.2`, `2.3`, `3.3`, `3.6`, `8.1`, `8.5`, `9.1`, `9.2`, `9.3`, `16.2`, `18.1`, `19.1`, `19.2`, `19.3`
  - **Depends on**: TASK-15
  - **Concrete Steps**:
    1. **Setup step:**
       - source from the active `.md` file, else empty with Run disabled (2.1, 2.3)
       - a `FuzzySuggestModal` note picker (2.2)
       - a template dropdown, preselected from the command or the last-used template (19.3)
       - a folder suggester or "next to source"
       - an engine dropdown with a Local/Remote label (3.3, 18.1)
       - a "configure an engine" panel when there are no engines (3.6)
       - nothing in this step waits on the network (1.5)
    2. **Running step:** live streamed text in a read-only CodeMirror view (8.5), status per request, Cancel.
    3. **Preview step:**
       - an editable CodeMirror Markdown editor holding the exact text that will be saved (9.1, 9.2)
       - a warnings strip: truncation, dropped tags, unanswered prompts, notices
       - Save / Discard (9.3) / Back
    4. The long-note confirm modal (16.2) and the collision "ask" modal (from TASK-12's setting).
    5. Sizing: about 90% of the viewport for Running and Preview, full-screen on mobile. Theme variables only (19.1). Keyboard: tab order, `Mod+Enter`, `Esc` (19.2). Persist `UiState`.
    6. Covered end to end in TASK-21, plus a manual theme check in TASK-23.

- [ ] **TASK-17: Ribbon and commands**
  - **Associated Acceptance Criteria**: `1.1`, `1.2`, `1.3`, `1.4`
  - **Depends on**: TASK-16
  - **Concrete Steps**:
    1. Add the ribbon icon and the "Open Inference Machine" command (1.1, 1.2).
    2. Add a `derive-<templateId>` command per template, named "Derive with &lt;name&gt;", that opens the modal with that template preselected (1.3).
    3. When templates change, re-sync: `removeCommand` for removed or renamed templates, and `addCommand` for new or renamed ones (1.4).
    4. Unit-test the sync logic against the test double. End-to-end test in TASK-21.

- [ ] **TASK-18: Settings tab and template editor**
  - **Associated Acceptance Criteria**: `3.1`, `3.2`, `3.4`, `3.5`, `3.7`, `5.1`, `6.4`, `16.3`, `17.2`, `21.7`
  - **Depends on**: TASK-10, TASK-11, TASK-13
  - **Concrete Steps**:
    1. **Engines section:**
       - list and add/edit forms for provider, name, base URL, `SecretComponent`, model (List models plus free text), temperature, max output tokens, context window (with a "can't warn" note when empty, 16.3)
       - Test, which reports success or the normalized error (3.1, 3.4)
       - Set default (3.2)
       - Delete (3.5)
       - "Detect LM Studio" with a port field, hidden on mobile (17.2)
    2. **Templates section:** a list with New, Duplicate, Edit, Delete and Restore built-ins (5.1), plus Import and Export (from TASK-19).
    3. **TemplateEditorModal:**
       - CodeMirror fields with `knap/codemirror` highlighting and lint from `diagnose()` and `validate` (6.4, 21.7)
       - a properties table (name, type, value)
       - tri-state Inherit controls for every overridable setting
       - tagging overrides, including preferred tags
       - engine dropdown with Inherit
       - skip preview, references and omit-empty
    4. **Defaults sections:** output, tagging and references. **About:** the network-use disclosure (18.0.5).
    5. Covered end to end in TASK-21.

- [ ] **TASK-19: Template import/export and example templates**
  - **Associated Acceptance Criteria**: `20.1`, `20.2`, `20.3`, `20.4`, `20.5`, `20.6`
  - **Depends on**: TASK-2, TASK-13
  - **Concrete Steps**:
    1. Export the selected templates to `{schemaVersion, plugin, templates}` JSON. Strip `id` and `origin`, map `engineId` to `engineName`, and never include a secret (20.2).
    2. Import:
       - validate the whole file before changing anything (20.4)
       - give each template a new `id`
       - number names on collision (20.3)
       - match `engineName` to an existing engine, else leave it unset
    3. Write `src/core/examples/recipe-card.json`, `book-reference.json` and `movie-reference.json`:
       - inline prompts adapted from kepano's Recipes, Goodreads and IMDB/Letterboxd templates
       - "leave empty rather than guess" instructions
       - `omitEmptyProperties: true`
       - copied to `examples/` in the repository for users
    4. Tests:
       - a round trip gives an identical template (20.1)
       - no secret in the exported text (20.2)
       - collision naming (20.3)
       - a malformed file is rejected with no change (20.4)
       - each example imports and renders against a fixture engine on sample notes (20.5)
       - Book reference with a missing year gives no `year` property (20.6, automated half)

### Milestone 6: Mobile, end-to-end tests and release

**Done when:** Mobile verified, end-to-end tests in CI, README and release workflow done, real-model verification recorded.

- [ ] **TASK-20: Mobile pass**
  - **Associated Acceptance Criteria**: `17.1`, `17.2`
  - **Depends on**: TASK-16, TASK-18
  - **Concrete Steps**:
    1. Audit for Node or Electron APIs and desktop-only DOM assumptions. The lint rule from TASK-1 should already catch them.
    2. Hide LM Studio detection under `Platform.isMobile`, with an explanation (17.2). Make the modal full-screen and check touch targets.
    3. Run the core flow with a cloud engine in Obsidian mobile, or `wdio-obsidian-service`'s mobile emulation (17.1).

- [ ] **TASK-21: End-to-end tests**
  - **Associated Acceptance Criteria**: `1.1`, `1.2`, `1.3`, `1.4`, `2.1`, `2.3`, `2.4`, `3.6`, `9.1`, `9.3`, `9.4`, `10.1`, `10.4`, `10.5`, `10.8`, `17.1`, `17.2`, `19.2`, `19.3`
  - **Depends on**: TASK-16 to TASK-20
  - **Concrete Steps**:
    1. Set up `wdio-obsidian-service` with a fixture vault and a local mock LLM server: an OpenAI-compatible stub that serves canned streaming and JSON responses, with CORS enabled and with it disabled.
    2. Scenarios:
       - ribbon and command open the popup
       - "Derive with" preselects the template
       - renaming or deleting a template changes its commands
       - active-note prefill and the empty-source case
       - the no-engine panel
       - the full run with preview, edit and save
       - discard writes nothing
       - skip preview
       - the folder and alongside locations
       - collision numbering
       - the references heading
       - open after create on and off
       - a keyboard-only run
       - the last-used template remembered
       - the source note unchanged after every scenario
       - mobile emulation: the core flow, with Detect hidden
       - the CORS-disabled stub falls back to non-streaming and the run still succeeds
    3. Add them to CI as a separate, non-blocking job at first. Make it blocking once it's stable.

- [ ] **TASK-22: README, disclosure and release setup**
  - **Associated Acceptance Criteria**: `18.3`
  - **Concrete Steps**:
    1. Write the README:
       - what the plugin does
       - setup for each provider, including LM Studio (CORS for streaming, tokens when authentication is on)
       - templates, variables, filters and inline prompts, with links to the `knap` and Web Clipper docs
       - tagging
       - built-in and example templates
       - the **network-use disclosure** (18.3): note contents go to the configured provider only
       - SecretStorage keys are per device and must be re-entered on each device
    2. Add a `LICENSE` (MIT) and a `CHANGELOG.md` with an Unreleased section. Add a release workflow that attaches `main.js`, `manifest.json` and `styles.css` to a tag with the bare version number.

- [ ] **TASK-23: Pre-release verification with real models**
  - **Associated Acceptance Criteria**: `3.1`, `4.1`, `4.5`, `8.5`, `15.2`, `19.1`, `20.5`, `20.6`
  - **Concrete Steps**:
    1. Run each built-in and example template against one model per provider, plus LM Studio with authentication off and on. Record the results in `spec/obsidian-inference-machine/verification.md`.
    2. Confirm:
       - Comprehensive summary includes its sections (15.2)
       - the example templates leave unknown properties empty (20.5, 20.6)
       - streaming works on each provider that allows it (8.5)
       - "Test" passes for every provider type (3.1)
       - LM Studio detection works with and without a token (4.1, 4.5)
    3. Check the popup and settings under the default light and dark themes and one popular community theme (19.1).
    4. File any model-behavior gaps as prompt fixes to the built-ins before release.
