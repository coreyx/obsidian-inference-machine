# Walkthrough: Obsidian Inference Machine

Inference Machine is an Obsidian plugin that derives a new note from an existing one with an AI model, the way Web Clipper turns a web page into a note. A popup, opened from the ribbon or a command, sends the current note through a template to a saved engine (Anthropic, OpenAI, Google Gemini, LM Studio or any OpenAI-compatible server), shows an editable preview, and saves the result in a chosen folder or next to the source. Tags are carried over from the source, kept to one spelling each, and can be suggested by the AI.

The product is described in [`product.md`](./product.md), the requirements in [`requirements.md`](./requirements.md) (REQ-1 to REQ-22, 126 acceptance criteria), and the build in [`tech.md`](./tech.md), [`design.md`](./design.md) and [`tasks.md`](./tasks.md) (TASK-1 to TASK-29, all done).

## What Was Implemented

The code is in four layers. `src/core` is pure TypeScript with no Obsidian import, which ESLint enforces, so it's tested without Obsidian. `src/engines` talks to providers, `src/obsidian` adapts the vault and settings, and `src/ui` and `src/run` hold the popup, the settings and the run itself.

### 1. Foundation (Milestone 1)
- **Project scaffold** (TASK-1): esbuild, TypeScript 6.0.3 (pinned because typescript-eslint needs the JS API that TypeScript 7 dropped), ESLint 9 with `eslint-plugin-obsidianmd`, and Vitest with coverage thresholds enforced in `npm test`.
- **`core/schema.ts`, `core/defaults.ts`, `core/data-validation.ts`, `obsidian/settings-store.ts`** (TASK-2): the `data.json` model with a schema version, safe defaults that need no AI, and validation that drops bad fields with a warning instead of failing to load.
- **`core/resolve.ts`** (TASK-3): merges popup choices over the template over the global config into one run config.

### 2. Core logic (Milestone 2)
- **`core/tags/*`** (TASK-4): source tags from frontmatter and inline `#tags`, one spelling per tag across case and separators, tag formats (kebab, snake, camel, Pascal, or a custom one described in words), `ai/`-style prefixes, and validity rules.
- **`core/template/*`** (TASK-5): variables (`{{title}}`, `{{content}}`, `{{properties.x}}` and others), Web Clipper's filters and logic through knap 0.6.0, and the main prompt, with the note's filename and contents appended when the prompt doesn't place them.
- **`core/output.ts`, `core/filename.ts`, `core/compose.ts`** (TASK-6): the output note's frontmatter, body, `# References` link back to the source, and a safe, unique filename.
- **`core/inline.ts`** (TASK-7): Web Clipper-style inline prompts, all answered in one JSON request, with filters applied to the answers.
- **`core/tokens.ts`** (TASK-8): a token estimate for the long-note warning.

### 3. Engines (Milestone 3)
- **`engines/transport.ts`, `engines/sse.ts`** (TASK-9): `requestUrl` for every request, and `fetch` only to stream. When the browser blocks streaming (CORS), the request falls back to a complete one. Errors become plain messages that never contain a key.
- **`engines/anthropic.ts`, `openai.ts`, `gemini.ts`, `base.ts`, `model-metadata.ts`** (TASK-10): each provider's chat, streaming, model listing and Test, and known context windows for models whose provider doesn't report one.
- **`engines/lmstudio.ts`, `ui/detect-flow.ts`** (TASK-11): LM Studio detection across API versions, token authentication, and one engine per port.

### 4. Headless run (Milestone 4)
- **`obsidian/*`** (TASK-12): a read-only note reader, the note writer, the vault tag index, links that follow the vault's link settings, and API keys kept only in Obsidian's SecretStorage.
- **`core/builtins/*`, `core/templates.ts`** (TASK-13): five built-in templates sharing one "reading the source note" guidance, upgraded in place when unedited, and restorable when deleted.
- **`core/tagging-request.ts`** (TASK-14): the AI tagging request, with the vault's tags and preferred tags as guidance.
- **`run/run-controller.ts`** (TASK-15): one run at a time: size check, main, inline and tagging requests in parallel, output composed, then preview or save. Cancelling, or starting another run, cancels the one in flight.
- **Single-string tags** (TASK-25): a `tags` value written as one string is split on commas and spaces.

### 5. User interface (Milestone 5)
- **`ui/derive-modal.ts`, `ui/preview-editor.ts`** (TASK-16): the popup with source, template, location and engine choices, a live view while it streams, an editable CodeMirror preview, and long-note and filename-collision prompts.
- **`ui/commands.ts`** (TASK-17): the ribbon icon, **Open**, and one **Derive with** command per template, such as **Derive with Comprehensive summary**.
- **`ui/settings-tab.ts`, `ui/engine-modal.ts`, `ui/template-editor.ts`** (TASK-18): settings, engine and template lists with reordering, and editors that say what's missing before Test or Save.
- **`core/template-transfer.ts`, `ui/template-transfer.ts`, `examples/`** (TASK-19): import and export as JSON, with no keys ever exported, and the Recipe card, Book reference and Movie reference examples.
- **Declarative settings** (TASK-24): `minAppVersion` raised to 1.13.4 so the settings use Obsidian's declarative definitions, which its settings search finds.

### 6. Template triggers and reasoning models (Milestone 7)
- **Output limits and reasoning** (TASK-26): the output limit is sent only when set, except to Anthropic, which requires one and gets 8,192. `core/reasoning.ts` removes `<think>` working from every response before it reaches a note, an inline answer or a tag list. A new `output-limit` error explains when a model spent its whole limit reasoning.
- **`core/triggers.ts`** (TASK-27): rules such as `#reading`, `folder:Meetings`, `property:type=book`, `title:/^Meeting/i` and `content:/regex/`.
- **Triggers in the popup and template editor** (TASK-28): the popup preselects the first matching template in list order and says which rule matched. A **Derive with** command still wins. The template editor lists any rule it can't read.
- **LM Studio context length** (TASK-29): long-note warnings use the smaller of the engine's context window and the length LM Studio has the model loaded with. An engine can instead load the model with its context window before each run, which the popup shows as "Loading the model in LM Studio…".

### 7. Mobile, end-to-end tests and release (Milestone 6)
- **Mobile** (TASK-20): works on mobile. LM Studio detection is replaced by a note on how to add LM Studio as an OpenAI-compatible engine.
- **End-to-end tests** (TASK-21): `wdio-obsidian-service` drives real Obsidian against a mock LLM server.
- **Release setup** (TASK-22): README with the network-use disclosure, MIT license, CHANGELOG, a CI workflow, and a release workflow that attaches `main.js`, `manifest.json` and `styles.css`.
- **Real-model verification** (TASK-23): see below and [`verification.md`](./verification.md).
- **Demo vault**: `demo/vault`, opened with `npm run demo`, for trying the plugin with your own engines.

## Verification & Test Results

### Automated Tests
Ran the full suite after the last code change:
- **Unit tests** (`npm test`): **Passed**. 340 tests in 22 files. Coverage is 99.0% of statements, 95.3% of branches and 99.3% of lines overall, above the per-area targets in [`tasks.md`](./tasks.md).
- **End-to-end tests** (`npm run test:e2e`): **Passed**. 9 spec files: 17 desktop and 5 trigger scenarios on Obsidian 1.14.4 and again on 1.13.4, plus 2 under mobile emulation. The suite also passes in GitHub Actions, where it blocks a failing push. Its first run there failed on the mobile test, because the test clicked Run while the popup was still sliding into view. The tests now wait for the popup to settle, and the job has passed since.
- **Lint** (`npm run lint`): **Passed** with one intended warning, the `fetch` in `engines/transport.ts`. Obsidian's `requestUrl` can't stream, so `fetch` is used for streaming only.
- **Build** (`npm run build`): **Passed**.

### Real-model verification
TASK-23 ran every built-in and example template against real models. The full results are in [`verification.md`](./verification.md).
- **OpenAI** (`gpt-5.4-nano`), **Anthropic** (`claude-haiku-5-5`) and **Gemini** (`gemini-3.8-flash`): **9 of 9 passed** each, with streaming. Two Gemini runs were first reported as cancelled, because the popup was used during the scripted runs and shares the run. Both passed when run again.
- **LM Studio**: **9 of 9 passed** with a 27B reasoning model and no output limit. A first pass before Milestone 7, with another model and a 1,500-token limit, passed only 3 of 9: the model spent the limit reasoning, and one note kept its `<think>` text. Milestone 7 was added to fix that.
- **LM Studio context length** (4.7, 4.8, 4.9): **Passed** against the real server.
- **LM Studio detection**: **Passed** with authentication off, with authentication on and a stored token, and through the token prompt (4.1, 4.5).
- **Themes** (19.1): **Passed**. The popup and settings are readable under the default dark and light themes and the Minimal theme.

### Regression Testing
The unit and end-to-end suites ran after every task, and both pass on the final commit. You reported six problems in the engine form while setting up engines for verification: buttons made the settings panel jump, Test needed a listed model, changing the provider kept old values, the default name couldn't be kept, required fields weren't marked, and duplicate engine names were allowed. All six were fixed in `d96bf03` and covered by tests.

## Manual Verification

Automated tests use a mock server, so check these with your own engines:

1. **Install:** run `npm run demo:install`, or copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/inference-machine/`, then enable **Inference Machine** under **Settings → Community plugins**.
2. **Add an engine:** in **Settings → Inference Machine**, click **+** next to **Engines**, choose a provider, link a stored key, or add one, with **Link…** under **API key**, type or list a model, and click **Test**. Expect "Connected…". Save stays disabled until the required fields are filled.
3. **Derive a note:** open a note, click the sparkles ribbon icon, choose **Key points / TL;DR** and click **Run**. Expect the output to stream in, then a preview that says it saves to `<folder>/<note> - Key points.md`. Edit a line, click **Save**, and check that the new note has your edit, the source's tags and a `# References` link back. Check that the source note is unchanged.
4. **Triggers:** edit **Action items**, add `folder:Meetings` under **Triggers**, then open the popup on a note in `Meetings`. Expect **Action items** preselected and "Matched folder:Meetings".
5. **LM Studio:** with LM Studio's server running, click **Detect** in the LM Studio row, and enter a token if asked. Then edit the engine and check that it shows "LM Studio has this model loaded at N tokens". Set **Context length in LM Studio** to "Load the model with this context window", with a context window different from the loaded one, and run a template. Expect "Loading the model in LM Studio…" as the popup's first row. The model must fit in GPU memory at that length, or runs get much slower.
6. **Mobile:** sync the plugin to a phone, add a key for an engine (keys don't sync), and run a template. Instead of a Detect button, the LM Studio row explains how to add LM Studio by your computer's network address.

## Follow-ups

- **Release:** no version has been cut. Use `prepare-release` when ready.
- **Shared run:** the popup, the commands and scripts share one run, so starting a run or closing the popup cancels one in flight. That's by design, but anyone scripting the plugin should know it.
- **Demo vault theme:** verification installed the Minimal theme in `demo/vault/.obsidian/themes`. That folder is gitignored, and the theme isn't active.
