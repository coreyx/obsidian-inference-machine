---
status: approved
---

# Obsidian Inference Machine Tech Stack

## Summary

The plugin is a TypeScript Obsidian community plugin built with esbuild from the official sample-plugin template, and it uses Obsidian's own APIs for everything it can:
- **UI:** Obsidian's native UI components.
- **Editors:** CodeMirror 6, which Obsidian already ships.
- **Frontmatter and tags:** Obsidian's metadata cache and YAML helpers.
- **API keys:** Obsidian's SecretStorage.
- **Network:** `requestUrl` plus `fetch` for streaming.

Beyond those, it adds:
- **Templates:** `knap`, the MIT-licensed template engine Obsidian maintains, which also powers Web Clipper.
- **AI providers:** thin, hand-written clients for the four provider wire formats, with no provider SDKs.
- **Tests:** Vitest, with an optional end-to-end layer on `wdio-obsidian-service`.

## Decisions

### Language, build and packaging
**Choice:** TypeScript, bundled to a single `main.js` with esbuild, from the official [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) layout:
- npm, with Node 20 or later.
- `obsidian`, `electron`, `@codemirror/*` and `@lezer/{common,highlight,lr}` are marked external.
- `manifest.json` sets `isDesktopOnly: false` and `minAppVersion: 1.13.4` (see UI and SecretStorage below).
- Releases follow the sample plugin's process: `manifest.json`, `main.js` and `styles.css` attached to a GitHub release whose tag is the bare version number.

Current versions at time of writing: `obsidian` typings 1.14.4, TypeScript 7.0.2, esbuild 0.28.2. The build pins TypeScript 6.0.3: TypeScript 7 is the native port, which has no JavaScript API, and `typescript-eslint` needs one.

**Why:** This is the path Obsidian supports and reviews for community plugins (constraint in [Product](./product.md)). REQ-17 requires mobile, so the bundle must not depend on Node built-ins, which esbuild's externals and a mobile test pass enforce. One bundle file is what Obsidian loads.

**Alternatives considered:**
- **Vite or Rollup.** Both work, but neither adds anything here, and they move away from the template the review process expects.
- **Bun or pnpm.** Personal preference only, and they diverge from the documented setup.

### Linting
**Choice:** ESLint with [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin) (0.4.2), which the sample plugin preconfigures.

**Why:** Obsidian maintains this plugin, and it encodes the community-plugin review guidelines. It catches problems such as unsafe DOM use, Node APIs that break mobile (REQ-17), and missing cleanup on unload before submission instead of during review.

**Alternatives considered:** plain `typescript-eslint` alone, which misses the Obsidian-specific rules.

### UI
**Choice:** Obsidian's native UI API throughout:
- `Modal` for the popup, sized with plugin CSS so the preview step is big enough to edit a full note (REQ-9).
- `PluginSettingTab` built on Obsidian's declarative settings (`getSettingDefinitions()`, 1.13), so every setting appears in Obsidian's settings search. Rows with buttons, such as the engine and template lists, use its `render` entries. `Setting` and `SecretComponent` fill those rows.
- `FuzzySuggestModal` / `AbstractInputSuggest` for the source-note and folder pickers (REQ-2, REQ-10).
- `Notice` for notices.
- `addRibbonIcon` and `addCommand` for entry points (REQ-1).

No UI framework.

**Why:**
- REQ-19 requires the UI to look native under every theme and work from the keyboard. Obsidian's components already use its theme variables and focus handling.
- The UI is a handful of forms and two editors, which doesn't need a framework's state model.
- Staying framework-free keeps the bundle small and the code easy to review.

**Alternatives considered:**
- **Svelte 5.** The most common framework in Obsidian plugins. Its reactive state would make the popup and settings code shorter. It costs a compiler step, a runtime in the bundle, and wrapper work to keep Obsidian's look. It's worth revisiting if the settings UI grows past forms.
- **React or Preact.** A bigger runtime than Svelte for the same benefit.

### Editors (template editor and preview)
**Choice:** CodeMirror 6 `EditorView` instances, using the `@codemirror/*` packages Obsidian already provides at runtime, which are external and not bundled:
- **Template editor:** `knap/codemirror` adds template syntax highlighting. `knap`'s validation flags unknown variables and filters as CodeMirror lint diagnostics (REQ-6 6.0.4, REQ-7 7.0.3).
- **Preview editor:** `@codemirror/lang-markdown` (6.5.2), the one CodeMirror package that is bundled, provides Markdown editing (REQ-9).

**Why:**
- CodeMirror 6 is the editor Obsidian itself uses on desktop and mobile, so it behaves and performs consistently with notes of any size (REQ-9, REQ-17).
- Using the copy Obsidian provides costs nothing in bundle size.
- `knap` ships a ready-made adapter for it.

**Alternatives considered:**
- **A plain `<textarea>`.** Simplest, but it has no highlighting or lint marks for templates, and it handles large notes poorly.
- **Embedding Obsidian's own Markdown editor.** It isn't part of the public API, would break on Obsidian updates, and would likely fail plugin review.
- **Writing a temporary note to the vault for preview.** This violates 9.0.3, since discarding must leave the vault untouched.

### Template engine (variables, filters, logic)
**Choice:** [`knap`](https://github.com/obsidianmd/knap) (MIT, 0.6.0, maintained by Obsidian). This is the template engine Web Clipper and Obsidian Importer use, published as its own package:
- `createEngine` with `standardFilters`.
- The plugin's variables (REQ-6) are passed in as data.
- The AI output is exposed as an `output` variable to the body wrapper and property templates.

**Why:**
- REQ-6 and REQ-7 require Web Clipper's syntax and filter behavior (acceptance criterion 7.1 is parity with Web Clipper's filters). Using the same engine gives parity by construction instead of by reimplementation.
- It parses templates into an AST and never uses `eval`, which suits templates imported from other people (REQ-20).
- Its validation API supports flagging errors in the editor.
- It includes every first-release filter in REQ-7, plus Web Clipper's logic (conditionals and loops) at no extra cost.
- Its only dependency is `dayjs`.

**Alternatives considered:**
- **Writing a Web Clipper-compatible engine by hand.** This is a lot of work and its behavior would drift from Web Clipper over time.
- **Handlebars or Mustache.** Wrong syntax and filters for users who know Web Clipper.
- **Copying Web Clipper's source.** Unnecessary now that the engine is a published package.

### Inline prompt variables (REQ-21)
**Choice:** Web Clipper's Interpreter approach, built on `knap`:
1. **Collect.** Parse the filename pattern, property values and body wrapper with `knap`, and collect every inline prompt variable (`{{"…"}}`) with its filters. `knap`'s parser already treats names that start with `"` as valid prompt variables, which is how Web Clipper uses them. Prompt variables inside the main prompt or prompt context are reported as errors (21.0.7).
2. **Ask once.** Send one request containing the rendered prompt context and the numbered prompts (`prompt_1` … `prompt_n`), asking for a single JSON object. Structured output is requested where the provider supports it natively: OpenAI's `response_format`, Gemini's `responseMimeType: application/json`. Elsewhere, including Anthropic and OpenAI-compatible servers whose JSON support varies, it's requested by instruction only. Every response goes through the same defensive parser: extract the JSON object, repair common escaping problems, then fall back to per-key matching, which is what Web Clipper's `interpreter.ts` does.
3. **Render.** Render the templates with `knap`, resolving each prompt variable to its answer through `knap`'s asynchronous variable support, so the variable's filters apply to the response (21.0.4). Unanswered prompts resolve to empty, with a notice (21.0.6).

Within a run, the main generation request, the inline prompt request and the AI tagging request (14.0.2) are independent, so they're sent **concurrently**. Only the main generation streams. The other two use the non-streaming path, since their structured responses are only usable once complete.

**Why:**
- REQ-21 asks for Web Clipper's syntax and behavior. Following its proven one-request design keeps cost to one extra request, whatever the number of prompts (21.2).
- Reusing `knap` keeps highlighting, validation and filters consistent with the rest of the template.
- Sending the requests concurrently means inline prompts and tagging add little wall-clock time on top of the main generation.

**Alternatives considered:**
- **One request per prompt.** Simpler parsing, but cost and latency grow with each prompt.
- **Folding inline prompts into the main request.** Saves a request, but makes the main output structured, which breaks streaming (Q22) and the Markdown output contract.
- **Anthropic tool-use for guaranteed JSON.** More reliable parsing for one provider, but a second code path. The defensive parser covers it. Worth revisiting if parse failures show up in practice.

### AI provider clients
**Choice:** Thin, hand-written clients, one per wire format, behind a common `Engine` interface:
- Anthropic Messages API.
- OpenAI Chat Completions, which also covers every OpenAI-compatible endpoint, LM Studio included.
- Gemini `generateContent` / `streamGenerateContent`.

The shared interface covers complete, stream, list models, test, and context-window lookup. Together they need an SSE parser, request and response mapping, and error normalization. **No provider SDKs.**

**Why:**
- **Mobile and CORS.** REQ-17 requires mobile, and REQ-8 / Q22 require streaming with a fallback. That makes the transport the deciding factor (see Networking below), and it needs full control over every request. SDKs bring their own `fetch` handling, browser-mode flags and Node-oriented code paths.
- **Bundle size.** The three official SDKs together would multiply the bundle size to cover what amounts to three request shapes.
- **One code path for OpenAI-compatible endpoints.** REQ-3 requires them, and the OpenAI client handles them all.
- **Readable errors.** Normalizing errors in one place gives the plain-language messages 3.0.5 and 8.0.6 require.
- **Avoiding the predecessor's churn.** The YouTube summarizer's `@google/generative-ai` SDK has since been deprecated in favor of `@google/genai`.

**Alternatives considered:**
- **The official SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`).** Well maintained, but heavy, opinionated about transport, and in Gemini's case recently replaced.
- **The Vercel AI SDK (`ai` plus `@ai-sdk/*`).** A unified provider layer with streaming. It's attractive, but it's a large dependency tree, and its fetch-based transport still needs the same CORS fallback. The thin clients are small enough that a framework doesn't pay for itself.

### Networking and streaming
**Choice:** Two transports:
- **Streaming:** browser `fetch` with `ReadableStream` and SSE parsing, used where the endpoint allows cross-origin requests:
  - Anthropic, with its direct-browser-access header.
  - OpenAI.
  - Gemini.
  - OpenAI-compatible servers with CORS enabled. LM Studio has a server setting for this.
- **Non-streaming:** Obsidian's `requestUrl`, which bypasses CORS on desktop and mobile but [can't stream](https://forum.obsidian.md/t/support-streaming-the-request-and-requesturl-response-body/87381). It's used for:
  - model listing
  - "Test"
  - LM Studio detection
  - the AI tagging request
  - any generation where streaming fails

If a streaming `fetch` fails before the response starts (a CORS or network-type error), the client retries once through `requestUrl` without streaming. It then remembers that choice for that engine for the rest of the session.

**Why:**
- Q22 asks for streaming "where the provider supports it", and REQ-8 requires a run never to fail just because streaming isn't available. This split satisfies both.
- It works the same on mobile (REQ-17).
- Keeping detection on `requestUrl` means detection works with LM Studio's CORS setting off (REQ-4).

**Alternatives considered:**
- **`requestUrl` only.** Simplest, but no streaming, which drops Q22.
- **Node `http` / `https`.** Desktop-only, so it breaks REQ-17.
- **A proxy server.** Violates the "not a model host or proxy" non-goal in [Product](./product.md).

### LM Studio detection and context windows
**Choice:**
- **Detection (REQ-4):** probe LM Studio's native REST API with `requestUrl`: `GET /api/v1/models`, falling back to `/api/v0/models` (requires LM Studio 0.3.6 or later), then to the OpenAI-compatible `/v1/models`.
- **Authentication (Q25, 4.0.7):** every probe is sent first without a token, so servers with LM Studio's "Require authentication" off (the default, and the only mode before LM Studio 0.4.0) still need no setup. A 401 or 403 means authentication is required: the plugin asks for a token, stores it in SecretStorage, and repeats the probe with `Authorization: Bearer <token>`. The resulting engine sends that header on every request. The same optional Bearer key works for any OpenAI-compatible engine (3.0.10).
- **Model choice:** from the native API's loaded state, preferring a loaded model.
- **Context window (Q20, 3.0.9):** from the loaded instance's context length, falling back to `max_context_length`.
- **Context windows for other providers:**
  - Gemini: from the model metadata endpoint, which reports an input token limit.
  - Anthropic and OpenAI: from a small bundled table of known models where the API doesn't report a limit.
  - The value is always editable (REQ-16).

**Why:**
- LM Studio's native API reports which models are loaded and their context lengths, which the OpenAI-compatible `/v1/models` doesn't. That's what makes one-click detection and the long-note warning work.
- Falling back across API versions handles older LM Studio installs.

**Alternatives considered:** reading only `/v1/models`. It finds the server, but can't tell loaded from unloaded models or report context size.

### Token estimation (long-note warning)
**Choice:** a conservative character-based estimate (about 3.5 characters per token) of prompt plus note, compared with the engine's context window minus its maximum output tokens (REQ-16).

**Why:**
- The warning only needs to flag "probably too big" before sending.
- The estimate needs no network call, which keeps the popup instant (1.0.5).
- A real tokenizer would be wrong for most models here anyway: each provider uses its own.

**Alternatives considered:**
- **`js-tiktoken`.** Large, and only accurate for OpenAI models.
- **Provider count-tokens endpoints.** They add a network round trip and aren't available for every provider.

### Frontmatter, tags and links
**Choice:**
- **Reading notes:** `metadataCache.getFileCache` for the source note's frontmatter and inline tags. `parseFrontMatterTags` reads a `tags` list. A single string is split on commas and spaces by the plugin (11.0.4, Q28), because Obsidian reads a string as one tag only when it contains no spaces or commas.
- **Vault tag list for AI tagging (14.0.3):** built from `getAllTags` over each Markdown file's cache. It's cached and kept current from `metadataCache` change events, and only built when AI tagging is on (14.1).
- **Frontmatter in text:** `getFrontMatterInfo` and `parseYaml` / `stringifyYaml` for splitting and assembling frontmatter, including the AI output's frontmatter (8.0.7).
- **Source link:** `fileManager.generateMarkdownLink` follows the vault's link settings (Q16).

The tag pipeline (merge, normalize, dedup, format, validate; REQ-11 to REQ-14) is a **pure TypeScript module with no Obsidian imports**. It takes plain arrays and returns the final list.

**Why:**
- Obsidian's helpers parse tags and YAML the way Obsidian does, so the plugin and the vault never disagree about what a tag is.
- `generateMarkdownLink` is the only reliable way to honor the user's link settings.
- Keeping the tag pipeline pure makes it exhaustively unit-testable, which the product's "correct tags every time" goal and 12.5 require.

**Alternatives considered:**
- **`js-yaml` or `gray-matter`.** Duplicate what Obsidian already ships and may parse edge cases differently.
- **The undocumented `metadataCache.getTags()`, which the YouTube summarizer uses.** It isn't in the public typings, so it could change without notice.

### Credential storage
**Choice:** Obsidian's [SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage) (`app.secretStorage`, available since 1.11.4) with `SecretComponent` in settings:
- The plugin's settings store only the secret's ID per engine. This includes the optional key for OpenAI-compatible engines and LM Studio tokens (3.0.10, 4.0.7).
- The key itself is read at request time with `getSecret`.
- `minAppVersion` is 1.13.4, so SecretStorage is always available. No `data.json` fallback is needed, and REQ-18's "where available" always holds.

**Why:**
- It keeps API keys out of `data.json`, which syncs and is plain text (18.0.4).
- Users can reuse a key they've already stored for another plugin.

**Alternatives considered:**
- **Plaintext in `data.json`, as the YouTube summarizer does.** It syncs, but exposes keys to anything that reads the vault folder.
- **Supporting older Obsidian versions with a fallback.** That doubles the credential code to support versions more than nine months old.

### Testing
**Choice:**
- **Unit tests in Vitest (5.0.5)** for every pure module:
  - the tag pipeline
  - prompt assembly, including the auto-append rule in 5.0.5
  - code-fence and frontmatter stripping
  - the SSE parser
  - each provider's request and response mapping, against recorded fixtures
  - the token estimate
  - template import and export validation
  - The `obsidian` module is replaced with a small test double.
- **Integration tests** of the built-in templates through `knap`, with fixed variables.
- **Optional end-to-end tests** on [`wdio-obsidian-service`](https://www.npmjs.com/package/wdio-obsidian-service) (MIT, 3.3.0), which runs the plugin inside real Obsidian on desktop and its mobile emulation: the popup-to-saved-note flow (REQ-8 to REQ-10) and mobile gating (REQ-17).

**Why:**
- Most of the acceptance criteria are pure input-to-output checks, which Vitest covers quickly, and Web Clipper uses Vitest too.
- The end-to-end layer covers what can only be checked inside Obsidian, without making every commit wait on it.

**Alternatives considered:**
- **Jest.** Slower and more configuration for ESM.
- **Node's built-in test runner, as the YouTube summarizer uses.** Fewer conveniences for mocking and fixtures.

## Lessons from Web Clipper

[Web Clipper](https://github.com/obsidianmd/obsidian-clipper) is MIT-licensed. Its source was reviewed (October 2026) to reuse what fits and avoid what doesn't. Its constraints differ from ours: it's a browser extension, not an Obsidian plugin, and its AI step fills small inline prompts rather than producing a whole note.

| Area | What Web Clipper does | What we take from it |
|---|---|---|
| Template engine | Renders through `knap` (`src/utils/template-compiler.ts`, `filters.ts`). | Use `knap` directly (see above). |
| Template data model | `Template` = `name`, `noteNameFormat`, `path`, `noteContentFormat`, `properties[]` (`name`, `value`, `type`), `context` (the AI prompt context), `behavior` (create / append / prepend / overwrite). | Mirror these field names where they mean the same thing: `noteNameFormat` → filename pattern, `path` → output folder, `noteContentFormat` → body wrapper, `properties` with types. This makes the model familiar to Web Clipper users. We have no `behavior` setting, since we always create a new note (REQ-10). |
| Import/export | JSON with a `schemaVersion` field (`0.1.0`), required-field validation, and a numbered name on collision. | Same pattern for REQ-20, with our own `schemaVersion` so the format can change later. Engine credentials are never included (20.0.3). |
| Providers and models | `Provider` (`baseUrl`, API key, `presetId`) is separate from `ModelConfig` (`providerId`, `providerModelId`, `enabled`). Presets come from a `providers.json` downloaded from GitHub at runtime. | Our "engine" is provider plus model plus settings (REQ-3). With SecretStorage, several engines can share one stored key by ID, which gives the main benefit of Web Clipper's split without the extra layer. Presets for the three named providers are **bundled**, not downloaded, so the plugin makes no network calls the user didn't ask for (18.0.2, review guidelines). |
| AI requests | Non-streaming `fetch` from the extension. Requests are built per provider by checking the provider name or URL, including Anthropic's `anthropic-dangerous-direct-browser-access` header. Every prompt variable is answered in one JSON response (`prompts_responses`), parsed defensively with a regex fallback. It reports output cut off at the token limit as an error, and turns Ollama's CORS 403 into a hint about how to fix it. | This confirms the CORS problem our two-transport design solves. Unlike an extension, we have `requestUrl` to fall back to. We take three habits from it: (a) pick the request format by explicit provider type, never by name or URL; (b) detect truncated output (`stop_reason: max_tokens`, `finish_reason: length`, Gemini `MAX_TOKENS`) and warn about it in the preview; (c) turn CORS-type failures into a hint ("enable CORS in LM Studio for streaming") instead of a raw error. The defensive JSON parsing applies to our AI tagging response (REQ-14). |
| Tests | Vitest, with template fixtures (`src/utils/fixtures/templates`). | Same: Vitest plus fixture templates for the built-ins. |

## Constraints & risks

- **`knap` is pre-1.0 (0.6.0).** Its API may change between minor versions. It's mitigated by:
  - pinning the exact version
  - keeping all `knap` calls behind one small adapter module
  - Obsidian maintaining it, and Web Clipper and Importer depending on it, which makes abandonment unlikely
- **CodeMirror version coupling.** `@codemirror/lang-markdown` is bundled, but the core `@codemirror/*` packages come from Obsidian at runtime. A future Obsidian release could ship a CodeMirror core that the bundled `lang-markdown` doesn't match. It's mitigated by pinning `lang-markdown` to the version range compatible with the `@codemirror/language` that Obsidian ships, and checking on each Obsidian major release.
- **Streaming depends on CORS.** Providers or local servers that don't send CORS headers silently get non-streaming output through the fallback. For LM Studio, streaming needs its server CORS setting turned on, which settings and the README should say.
- **Structured output from small local models.** Inline prompts (REQ-21) and AI tagging (REQ-14) need a model to return parseable JSON. Small local models break this more often than cloud models. It's mitigated by the defensive parser, by never letting a parse failure lose the note (14.0.9, 21.0.6), and by fixture tests built from real malformed responses.
- **SecretStorage values don't sync between devices.** The docs say secrets live in the vault's local storage, and plugin authors report having to re-enter them on each device. Mobile users will need to enter their API key again on each device, which the README should say.
  - There's also an unverified report that desktop secrets may sit in local storage rather than the OS keychain.
  - Either way, this is still an improvement over plaintext in `data.json`, but the plugin shouldn't claim keychain-grade protection.
- **Bundled model metadata goes stale.** The table of context windows for Anthropic and OpenAI models will drift as models change. That's why the value is always editable and the warning is advisory.
- **Undocumented provider and LM Studio changes.** LM Studio's native REST API has changed shape between v0 and v1. Detection falls back across versions, and these paths should get fixture tests.
- **minAppVersion 1.13.4** (July 2026, the first public 1.13 release) excludes users on older versions. Obsidian updates its app automatically, so this is a small group, and the gain is the declarative settings API, which puts the plugin's settings in Obsidian's settings search, plus other 1.13 APIs such as `setDestructive()`. It was raised from 1.11.4 during implementation.
- **Licenses:**
  - **MIT:** `knap`, `dayjs`, `@codemirror/lang-markdown`, Vitest, `wdio-obsidian-service`.
  - **MIT:** also `eslint-plugin-obsidianmd`, and Web Clipper (reference only, nothing copied).
  - **0BSD:** the sample-plugin template.

  None of these conflict with an MIT plugin license.

## Open questions

Question IDs continue from `requirements.md`, which tracks them all in its [section 3](./requirements.md#3-open-questions). Questions raised while writing this document:

| ID | Question | Status |
|---|---|---|
| Q23 | Importing Web Clipper templates | Answered: no. See the [template findings](../../analysis/web-clipper-templates/findings.md) |
| Q24 | Web Clipper-style inline prompt variables | Answered: yes. REQ-21, implemented as described under Inline prompt variables |
| Q25 | API keys for OpenAI-compatible engines and LM Studio | Answered: yes. See LM Studio detection and Credential storage |
| Q26, Q27 | Clipping-aware built-ins; example templates | Answered in `requirements.md` (15.0.6–15.0.8, 20.0.7–20.0.8). Neither affects this stack. |
