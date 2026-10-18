---
status: approved
---

# Requirements Specification: Obsidian Inference Machine

## 1. Project Summary

See [Product](./product.md) for the problem, audience, value proposition, goals and non-goals. This spec covers the **first release** of the plugin:

- The popup and commands for deriving a note from a source note.
- Inference engines for Anthropic, OpenAI, Gemini and OpenAI-compatible APIs, plus LM Studio auto-detection.
- Templates with variables, filters and Web Clipper-style inline prompt variables, the built-in template set, and template import and export.
- Output note creation and placement.
- The tagging pipeline: merging, dedup, formats and optional AI tagging.

Batch processing over many notes is out of scope for this release (Q10).

**Settings resolution.** Most configurable behavior below resolves in this order. The first layer that sets a value wins:

1. A one-off override in the popup, for the settings the popup exposes.
2. The template.
3. The global config.
4. The built-in safe default.

Built-in safe defaults never require an inference call. In the requirements, "the resolved X" means X after this resolution.

**Question IDs.** A Q number in parentheses, such as (Q13), cites the question that decided that behavior. Q1–Q11 were answered in `product.md`, and Q12 onward are tracked here (see [section 3](#3-open-questions)).

## 2. Requirements (EARS Format)

Requirements use the Easy Approach to Requirements Syntax (EARS):
- **Ubiquitous**: The system shall &lt;response&gt;.
- **Event-Driven**: When &lt;trigger&gt;, the system shall &lt;response&gt;.
- **State-Driven**: While &lt;precondition&gt;, the system shall &lt;response&gt;.
- **Unwanted Behavior**: If &lt;unwanted condition&gt;, then the system shall &lt;response&gt;.
- **Optional Feature**: Where &lt;feature is enabled&gt;, the system shall &lt;response&gt;.

### REQ-1: Entry points

**User Story**: As an Obsidian user, I want a ribbon button and commands that open the Inference Machine, so that I can start deriving a note from wherever I am.

- **1.0.1 (Ubiquitous)**: The system shall add a ribbon button that opens the Inference Machine popup.
- **1.0.2 (Ubiquitous)**: The system shall register a command, "Open Inference Machine", that opens the popup.
- **1.0.3 (Ubiquitous)**: The system shall register one command per template, "Derive with &lt;template name&gt;", that opens the popup with that template preselected (Q21).
- **1.0.4 (Event-Driven)**: When a template is created, renamed or deleted, the system shall add, rename or remove its command to match.
- **1.0.5 (Ubiquitous)**: The system shall open the popup without waiting on any network request.

#### Acceptance Criteria
- **1.1**: Clicking the ribbon button opens the popup.
- **1.2**: Running "Open Inference Machine" from the command palette opens the popup.
- **1.3**: Running "Derive with Action items" opens the popup with "Action items" selected.
- **1.4**: Renaming a template renames its command. Deleting a template removes its command.
- **1.5**: With the network disconnected, the popup still opens immediately.

### REQ-2: Source note selection

**User Story**: As a user, I want the note I'm viewing to be picked automatically as the source, and to be able to change it, so that the common case takes no effort and other cases are still possible.

- **2.0.1 (Event-Driven)**: When the popup opens while a Markdown note is the active file, the system shall preselect that note as the source note.
- **2.0.2 (Ubiquitous)**: The system shall let the user change the source note to any Markdown note in the vault through a searchable picker.
- **2.0.3 (Unwanted Behavior)**: If no Markdown note is active when the popup opens, then the system shall leave the source note empty and require the user to pick one before running.
- **2.0.4 (Ubiquitous)**: The system shall never modify the source note.

#### Acceptance Criteria
- **2.1**: Opening the popup while viewing `Meetings/2026-10-01.md` shows that note as the source.
- **2.2**: The picker finds a note by partial name and switches the source to it.
- **2.3**: Opening the popup with no note open, or with a non-Markdown file such as a PDF or canvas active, shows an empty source, and the run button stays disabled until a note is picked.
- **2.4**: After any run, whether it succeeds, fails or is cancelled, the source note's content and modified time are unchanged.

### REQ-3: Inference engines

**User Story**: As a user, I want to set up one or more AI engines once and reuse them, so that I don't reconfigure providers for each note or template.

- **3.0.1 (Ubiquitous)**: The system shall support engines of four provider types: Anthropic, OpenAI, Gemini, and OpenAI-compatible, where the user supplies the base URL.
- **3.0.2 (Ubiquitous)**: The system shall let the user save multiple named engines, each with a provider type, credentials (where the provider needs them), a model, and optional generation settings (temperature, maximum output tokens, context window size).
- **3.0.3 (Ubiquitous)**: The system shall let the user mark exactly one engine as the global default.
- **3.0.4 (Event-Driven)**: When the user asks to list models for an engine, the system shall fetch the provider's available models where the provider supports listing. It shall also accept a model ID typed by hand.
- **3.0.5 (Event-Driven)**: When the user clicks "Test" on an engine, the system shall send a minimal request and report success, or the provider's error in plain language.
- **3.0.6 (Ubiquitous)**: The popup shall offer an engine dropdown that starts on the resolved engine (template, then global default), and a change there shall apply to that run only (Q5).
- **3.0.7 (Unwanted Behavior)**: If a template names an engine that no longer exists, then the system shall fall back to the global default and show a notice naming the missing engine.
- **3.0.8 (Unwanted Behavior)**: If no engine is configured, then the popup shall explain that an engine is needed and link to the engine settings instead of offering to run.
- **3.0.9 (Event-Driven)**: When the provider or LM Studio reports a model's context window, the system shall fill in the engine's context window setting automatically, and the user shall be able to edit it (Q20).
- **3.0.10 (Ubiquitous)**: OpenAI-compatible engines shall accept an optional API key, stored like any other credential (18.0.4). When a key is set, every request to that engine shall send it as `Authorization: Bearer <key>`, including model listing and "Test". When no key is set, no `Authorization` header shall be sent (Q25).
- **3.0.11 (Ubiquitous)**: When an engine's maximum output tokens setting is empty, the system shall send no output limit, so the provider's or model's own default applies. The exception is Anthropic, whose API requires a limit: there the system shall send 8,192 (Q34).

#### Acceptance Criteria
- **3.1**: An engine of each provider type can be saved and passes "Test" against a working endpoint.
- **3.2**: Two engines can be saved, for example "Local" and "Claude". Making "Claude" the default makes it the preselected engine for templates that don't set one.
- **3.3**: Switching the engine in the popup for one run doesn't change the template's or the global setting.
- **3.4**: "Test" with an invalid API key reports an authentication error, not a raw stack trace.
- **3.5**: Deleting an engine that a template uses, then running that template, uses the global default and shows a notice.
- **3.6**: A fresh install with no engines shows the "configure an engine" message in the popup.
- **3.7**: An LM Studio engine created by detection has its context window filled in when LM Studio reports one, and the user can change it.
- **3.8**: An OpenAI-compatible engine with an API key sends `Authorization: Bearer <key>` on generation, model listing and "Test". The same engine with no key sends no `Authorization` header.
- **3.9**: An OpenAI, Gemini or OpenAI-compatible engine with no maximum output tokens set sends no output limit. An Anthropic engine with none set sends `max_tokens: 8192`. Any engine with the setting filled sends that value.

### REQ-4: LM Studio auto-detection

**User Story**: As a local-model user, I want one button that finds my running LM Studio and configures an engine for it, so that local inference needs no manual setup.

- **4.0.1 (Event-Driven)**: When the user clicks "Detect LM Studio", the system shall probe LM Studio's local server at its default address (`http://localhost:1234`), or at a user-specified port.
- **4.0.2 (Event-Driven)**: When LM Studio responds, the system shall create, or update, an OpenAI-compatible engine with the detected base URL and a loaded model selected.
- **4.0.3 (State-Driven)**: While LM Studio reports more than one available model, the system shall let the user choose which one the engine uses, preselecting a loaded model.
- **4.0.4 (Unwanted Behavior)**: If LM Studio isn't reachable, then the system shall say so and suggest starting LM Studio's local server, without creating an engine.
- **4.0.5 (Unwanted Behavior)**: If LM Studio is reachable but has no model available, then the system shall say so and suggest loading a model.
- **4.0.6 (State-Driven)**: While running on Obsidian mobile, the system shall hide or disable "Detect LM Studio" (see REQ-17).
- **4.0.7 (Unwanted Behavior)**: If LM Studio answers detection with an authentication error (HTTP 401 or 403), then the system shall not report it as unreachable. It shall ask for an LM Studio API token, store it like any other credential (18.0.4), retry detection with it, and create an engine that sends it (3.0.10) (Q25).
- **4.0.8 (Ubiquitous)**: The message shown for an LM Studio authentication error shall say where tokens are created in LM Studio (Developer → Server Settings → Manage Tokens).
- **4.0.9 (Ubiquitous)**: For an LM Studio engine, the system shall read the context length the model is actually loaded with before each run, and use the smaller of that and the engine's context window setting for the long-note warning (16.0.1). The engine settings shall show the loaded context length, or that the model isn't loaded (Q35).
- **4.0.10 (Optional Feature)**: Where an LM Studio engine is set to "Load the model with this context window" (the default is "Let LM Studio decide"), the system shall, before each run, check whether the model is loaded with the engine's context window. If it isn't, the system shall unload it and load it with that context length, and show that the model is loading while it waits (Q35).

#### Acceptance Criteria
- **4.1**: With LM Studio's server running and one model loaded, a single click creates a working engine. A test request succeeds with no manual entry.
- **4.2**: With several models available, the user is offered a choice, and the loaded one is preselected.
- **4.3**: With LM Studio closed, clicking the button shows the "start LM Studio's server" message and creates no engine.
- **4.4**: Clicking "Detect" again when an LM Studio engine already exists updates that engine rather than creating a duplicate.
- **4.5**: With LM Studio's "Require authentication" on, detection asks for a token. Given a valid one, it creates a working engine whose requests carry the token.
- **4.6**: With "Require authentication" on and an invalid token, detection reports an authentication error that names where to manage tokens, not "LM Studio isn't reachable".
- **4.7**: With LM Studio running the model at 32,768 tokens and the engine's context window set to 65,536 with "Let LM Studio decide", a note of about 40,000 tokens triggers the long-note warning, giving the limit from 32,768.
- **4.8**: With "Load the model with this context window" and 65,536, a run first shows that the model is loading, and afterwards LM Studio reports the model loaded at 65,536 tokens.
- **4.9**: The settings for an LM Studio engine show the context length LM Studio has the model loaded with, or that it isn't loaded.

### REQ-5: Templates

**User Story**: As a user, I want saved templates that define both the prompt and the output note, so that each kind of derived note is configured once and reused.

- **5.0.1 (Ubiquitous)**: The system shall let the user create, edit, duplicate, rename and delete templates.
- **5.0.2 (Ubiquitous)**: A template shall have a name, and a main prompt, at least one inline prompt variable (REQ-21), or both. It may also set:
  - a filename pattern
  - frontmatter properties, whose values may contain variables
  - a body wrapper that places the AI output (for example, via an `{{output}}` variable)
  - an output location: a specific folder, or next to the source note
  - tagging settings (REQ-11 to REQ-14)
  - an engine
  - "Skip preview"
  - the references heading settings (REQ-10)
  - a prompt context for inline prompt variables (REQ-21)
- **5.0.3 (Ubiquitous)**: The system shall resolve every template setting the template leaves unset through the global config, and then the built-in safe default.
- **5.0.4 (Ubiquitous)**: The built-in safe defaults shall be (Q17):
  - output location next to the source note
  - filename pattern `{{title}} - <template name>`
  - no extra frontmatter properties
  - a body wrapper of just the AI output
  - merge source tags on
  - AI tagging off
  - preview on
  - link back to the source on
  - open the new note on
- **5.0.5 (Event-Driven)**: When a template's prompt contains no variable that inserts the note's contents, the system shall append the source note's filename and full contents after the prompt (Q13).

#### Acceptance Criteria
- **5.1**: A template can be created, duplicated, renamed and deleted from settings.
- **5.2**: A template that sets only a name and a prompt runs successfully, using global and built-in defaults for everything else.
- **5.3**: Setting a global output folder makes it apply to every template that doesn't set its own. A template's own folder overrides it.
- **5.4**: A template whose prompt is just "Summarize this." still sends the note's filename and full contents to the engine.
- **5.5**: With all defaults, deriving from `Projects/Alpha.md` with template "Summary" creates `Projects/Alpha - Summary.md`.

### REQ-6: Variables

**User Story**: As a template author, I want variables that pull note data into the prompt and the output note, so that one template works across many notes.

- **6.0.1 (Ubiquitous)**: The system shall resolve variables written as `{{name}}` in a template's prompt, filename pattern, property values and body wrapper, following Web Clipper's syntax.
- **6.0.2 (Ubiquitous)**: The system shall provide these variables (Q9):
  - the source note's title (filename without extension)
  - its full contents, frontmatter included
  - its body without frontmatter
  - its frontmatter as a whole
  - each individual frontmatter key
  - its path
  - its folder
  - its created and modified dates
  - the current date and time
  - the AI output, available in the body wrapper and property values only
- **6.0.3 (Unwanted Behavior)**: If a variable refers to a frontmatter key the source note doesn't have, then the system shall resolve it to an empty string.
- **6.0.4 (Unwanted Behavior)**: If a template uses an unknown variable name, then the system shall flag it in the template editor and resolve it to an empty string at run time.

#### Acceptance Criteria
- **6.1**: In a note with frontmatter `author: Ada`, `{{author}}`-style frontmatter access (exact syntax set in design) resolves to `Ada`.
- **6.2**: The body-only variable excludes the frontmatter block. The full-contents variable includes it.
- **6.3**: A variable for a missing key resolves to empty, and the run still succeeds.
- **6.4**: A misspelled variable is highlighted in the template editor.

### REQ-7: Filters

**User Story**: As a template author, I want filters on variables, so that I can lightly process text and frontmatter values without writing code.

- **7.0.1 (Ubiquitous)**: The system shall apply filters written as `{{variable|filter}}` and chained as `{{variable|filter1|filter2}}`, following Web Clipper's syntax and behavior wherever a filter shares a Web Clipper filter's name.
- **7.0.2 (Ubiquitous)**: The first release shall provide these filters (Q9): `lower`, `upper`, `trim`, `replace`, `split`, `join`, `first`, `last`, `slice`, `date`, `default`, `wikilink`, `list`.
- **7.0.3 (Unwanted Behavior)**: If a filter name is unknown, or its arguments are invalid, then the system shall flag it in the template editor. At run time it shall leave the value unfiltered and show a notice naming the filter.

#### Acceptance Criteria
- **7.1**: Each listed filter produces the same result as Web Clipper's filter of the same name on a shared set of test inputs.
- **7.2**: `{{missing_key|default:"n/a"}}` resolves to `n/a`.
- **7.3**: Chained filters apply left to right.
- **7.4**: An unknown filter shows a notice and doesn't fail the run.

### REQ-8: Running a template

**User Story**: As a user, I want to run a template on the source note from the popup, so that I get a derived note in a couple of clicks.

- **8.0.1 (Ubiquitous)**: The popup shall show the source note, the template, the output location and the engine, each prefilled from settings resolution and each changeable for this run.
- **8.0.2 (Event-Driven)**: When the user runs, the system shall build the prompt from the resolved template, with variables and filters applied, and send it to the resolved engine.
- **8.0.3 (State-Driven)**: While a request is in progress, the system shall show progress and offer a cancel action. Where the provider supports streaming, the system shall stream the output into the preview as it's generated (Q22).
- **8.0.4 (Event-Driven)**: When the user cancels, the system shall abort the request, discard any partial output, and create no note.
- **8.0.5 (Unwanted Behavior)**: If the AI output is wrapped in a single enclosing code fence (for example, ```` ```markdown … ``` ````), then the system shall remove the fence.
- **8.0.6 (Unwanted Behavior)**: If the request fails (network error, authentication error, rate limit, provider error or empty response), then the system shall show the error in plain language, keep the popup open with its selections, and create no note.
- **8.0.7 (Unwanted Behavior)**: If the AI output begins with a YAML frontmatter block, then the system shall remove the block from the body and merge its properties into the output note's frontmatter. The template's own properties win on conflicts, and any `tags` in the block go through the tag pipeline (REQ-11 to REQ-14) as AI tags (Q18).
- **8.0.8 (Unwanted Behavior)**: If a response contains reasoning wrapped in `<think>…</think>`, or starts with reasoning that ends at a `</think>` tag, then the system shall remove the reasoning before using the response: the main output, the inline prompt response and the AI tagging response. The reasoning is the model's working, not part of its answer (Q33).
- **8.0.9 (Unwanted Behavior)**: If a request ends at the output-token limit without any answer text, as happens when a reasoning model spends the whole limit reasoning, then the system shall say so in plain language and suggest raising the engine's maximum output tokens, rather than reporting an empty response. For the inline prompt and AI tagging requests, the notice shall say the same (Q33).

#### Acceptance Criteria
- **8.1**: With defaults and a built-in template, the flow from popup to preview needs one click on "Run" after the popup opens.
- **8.2**: Cancelling mid-request, including mid-stream, leaves the vault unchanged.
- **8.3**: A response wrapped in a `markdown` code fence is shown without the fence.
- **8.4**: An authentication failure shows a readable error, and clicking "Run" again after fixing the key works without reopening the popup.
- **8.5**: With a streaming-capable provider, text appears in the preview before the response is complete.
- **8.6**: Output that starts with `---\nstatus: draft\ntags: [x]\n---` yields a note whose frontmatter has `status: draft` and tag `x` (after dedup), with no second frontmatter block in the body.
- **8.7**: When the AI frontmatter and the template both set `status`, the template's value is kept.
- **8.8**: A response of `<think>planning…</think>` followed by `## Summary` and text produces a note whose body starts at `## Summary`, with no reasoning in it. A streamed response does the same.
- **8.9**: A fixture engine that stops at the output limit with no answer text produces an error saying the model used its whole output limit before answering, and suggesting a higher maximum output tokens. The same case in the inline prompt request produces a notice saying so.

### REQ-9: Preview and edit

**User Story**: As a user, I want to review and edit the generated note before it's saved, so that nothing lands in my vault that I didn't accept.

- **9.0.1 (Event-Driven)**: When a run completes, the system shall show the full output note in an editor large enough to read and edit a full note. The output note is the frontmatter, including the final tags and any inline prompt responses (REQ-21), plus the body.
- **9.0.2 (Event-Driven)**: When the user saves from the preview, the system shall create the note from the edited content.
- **9.0.3 (Event-Driven)**: When the user discards from the preview, the system shall create no note.
- **9.0.4 (Where)**: Where the resolved template has "Skip preview" enabled, the system shall create the note directly after the run, without the preview (Q6).

#### Acceptance Criteria
- **9.1**: The preview shows the frontmatter, including the final tags, and the body exactly as they would be saved.
- **9.2**: Edits made in the preview appear in the saved note.
- **9.3**: Discarding leaves the vault unchanged.
- **9.4**: A template with "Skip preview" creates the note without showing the preview.

### REQ-10: Output note creation

**User Story**: As a user, I want the new note created in the right place with a predictable name and a link back to its source, so that derived notes stay organized and traceable.

- **10.0.1 (Ubiquitous)**: The system shall create the output note at the resolved output location: the chosen folder, or the source note's folder.
- **10.0.2 (Unwanted Behavior)**: If the output folder doesn't exist, then the system shall create it.
- **10.0.3 (Ubiquitous)**: The system shall resolve the filename pattern and remove characters that aren't allowed in filenames.
- **10.0.4 (Unwanted Behavior)**: If a note with the resolved name already exists, then the system shall add a number to the name, the way Obsidian does (`Alpha - Summary 1`), and never overwrite. Where the "Ask on filename collision" setting is enabled, the system shall instead ask the user to rename, add a number, or cancel (Q8).
- **10.0.5 (Where)**: Where "Link back to the source" is enabled (the default), the system shall add a link to the source note under the resolved references heading. The heading text is configurable and defaults to `# References`. The link follows the vault's link format settings (Q16) (Q7).
- **10.0.6 (Event-Driven)**: When adding the source link, if the note already contains the references heading, the system shall add the link under that heading. Otherwise it shall create the heading at the end of the note.
- **10.0.7 (Where)**: Where "Open the new note" is enabled (the default), the system shall open the created note (Q7).

#### Acceptance Criteria
- **10.1**: Output set to `Summaries/` creates the note there, creating the folder if needed.
- **10.2**: Output set to "next to source" creates the note in the source's folder.
- **10.3**: A filename containing `:` or `?` is saved with those characters removed.
- **10.4**: Running the same template twice on the same note creates `Alpha - Summary` and then `Alpha - Summary 1`. Neither overwrites the other.
- **10.5**: With defaults, the new note ends with a `# References` heading followed by a link to the source note.
- **10.6**: If the AI output already contains `# References`, no second heading is added, and the source link goes under the existing one.
- **10.7**: Changing the heading setting to `## Sources` uses that heading instead.
- **10.8**: With "Open the new note" off, the new note is created but the active note doesn't change.

### REQ-11: Tag merging

**User Story**: As a user, I want the source note's tags carried into the derived note, so that the derived note is filed the same way as its source.

- **11.0.1 (Where)**: Where "Merge source tags" is enabled (the default), the system shall collect the source note's frontmatter `tags` and its inline `#tags` from the body, and add them to the output note's frontmatter `tags`.
- **11.0.2 (Ubiquitous)**: The system shall put tags in the output frontmatter in this order:
  1. source frontmatter tags, in their order
  2. source inline tags, in order of appearance
  3. tags from the template's static properties
  4. AI tags
- **11.0.3 (Ubiquitous)**: The system shall keep source tags exactly as the source spells them, unless "Apply tag format to source tags" is enabled (REQ-13) or a tag must be changed to be valid (13.0.4).
- **11.0.4 (Unwanted Behavior)**: If the source note's frontmatter `tags` is a single string rather than a list, then the system shall split it into tags on commas and spaces (Q28). Obsidian itself reads such a string as one tag only when it contains no spaces or commas, so this recovers what the note's author meant.

#### Acceptance Criteria
- **11.1**: A source with frontmatter tags `[Project, area/work]` and an inline `#idea` produces output tags `[Project, area/work, idea]`.
- **11.2**: With merging off, no source tags appear in the output.
- **11.3**: The output tags keep `Project` with its capital letter.
- **11.4**: A source with `tags: "alpha, beta"` (a string) yields `alpha` and `beta`.

### REQ-12: Tag deduplication

**User Story**: As a user, I want each tag to appear only once in the output, however it's spelled, so that my frontmatter stays clean.

- **12.0.1 (Ubiquitous)**: The system shall write each tag to the output frontmatter at most once.
- **12.0.2 (Ubiquitous)**: The system shall treat two tags as equivalent when they match after normalization (Q3):
  - the leading `#` is ignored
  - letter case is ignored
  - word boundaries are compared rather than separators, so `-`, `_`, camelCase or PascalCase boundaries, and `/` all count as the same separator
- **12.0.3 (Ubiquitous)**: When equivalent tags collide, the system shall keep one spelling, in this order of precedence:
  1. the source note's spelling (frontmatter before inline, first occurrence first)
  2. the template's spelling
  3. an existing vault tag that AI tagging reused
  4. among the remaining AI tags, the nested form (with `/`) over the flat form
- **12.0.4 (Ubiquitous)**: The system shall dedup within the source's own tags as well as across sources.
- **12.0.5 (Ubiquitous)**: Deduplication shall be done by the plugin, never left to the model.

#### Acceptance Criteria
- **12.1**: Source tags `#Project` in frontmatter and `#project` inline produce a single `Project`.
- **12.2**: `machine-learning`, `machine_learning` and `machineLearning` from any mix of sources produce one tag, spelled as in the highest-precedence source.
- **12.3**: Source `ai-machine-learning` plus AI `ai/machine-learning` produce `ai-machine-learning`.
- **12.4**: AI-only `ai-machine-learning` and `ai/machine-learning` produce `ai/machine-learning`.
- **12.5**: No test fixture, including fixtures where the model returns duplicates, ever produces a duplicate tag in the output frontmatter.

### REQ-13: Tag formats and validity

**User Story**: As a user, I want AI-created tags in the format my vault uses, and every tag guaranteed valid, so that new tags fit in and never break.

- **13.0.1 (Ubiquitous)**: The system shall offer these tag formats: kebab-case (default), snake_case, camelCase, PascalCase, and Custom, where the user describes the format in their own words.
- **13.0.2 (Ubiquitous)**: The system shall include the resolved format in the AI tagging instructions. A Custom format is passed as written.
- **13.0.3 (Ubiquitous)**: For the named formats, the system shall also convert AI-created tags to the format itself, rather than relying on the model. Each nested segment is converted separately, so `/` is kept. The exception is existing vault tags that AI tagging reused, which keep the vault's spelling.
- **13.0.4 (Ubiquitous)**: The system shall make every tag it writes valid in Obsidian: no spaces (replaced with the resolved format's separator), only letters, numbers, `_`, `-`, `/` and commonly accepted Unicode characters, and at least one non-numeric character.
- **13.0.5 (Unwanted Behavior)**: If a tag can't be made valid, for example because it is purely numeric like `1984`, then the system shall drop it and mention it in the preview.
- **13.0.6 (Where)**: Where "Apply tag format to source tags" is enabled (default off), the system shall convert source and template tags to the resolved format too (Q4).

#### Acceptance Criteria
- **13.1**: With kebab-case, an AI tag returned as `Machine Learning` is written as `machine-learning`.
- **13.2**: With camelCase, `ai/machine learning` becomes `ai/machineLearning`.
- **13.3**: With a Custom format, the user's description appears in the tagging instructions sent to the engine.
- **13.4**: A tag `1984` is dropped. A tag `y1984` is kept.
- **13.5**: With "Apply tag format to source tags" off, a source tag `My_Tag` is kept as `My_Tag`. With it on and kebab-case, it becomes `my-tag`.
- **13.6**: A reused vault tag `DevOps` stays `DevOps` under kebab-case.

### REQ-14: AI tagging

**User Story**: As a user, I want the option to have the AI suggest tags that fit my vault's existing taxonomy, so that derived notes are discoverable without manual tagging.

- **14.0.1 (Ubiquitous)**: AI tagging shall be off by default, and the user shall be able to turn it on globally or per template.
- **14.0.2 (Where)**: Where AI tagging is enabled, the system shall ask the resolved engine for tags based on the source note, as a separate request from the main generation (Q14).
- **14.0.3 (Where)**: Where "Reuse vault tags first" is enabled (default on, when AI tagging is on), the system shall send the vault's existing tags, ranked by use and capped at 1,000. It shall instruct the engine to reuse a matching existing tag before creating a new one. Where it's disabled, the system shall send no vault tags.
- **14.0.4 (Ubiquitous)**: The system shall ask for between the resolved minimum and maximum number of tags (default 3–7). If the engine returns more than the maximum, the system shall keep only the first ones up to the maximum.
- **14.0.5 (Where)**: Where "Existing tags only" is enabled (default off), the system shall discard any AI tag that isn't already in the vault.
- **14.0.6 (Where)**: Where the resolved template lists preferred tags, the system shall instruct the engine to favor them.
- **14.0.7 (Where)**: Where "Hierarchical prefixes" is enabled (default on), the system shall send the vault's existing group prefixes (for example `ai/`, `dev/frontend/`). It shall instruct the engine to reuse them first, and to create a new prefix only when none fits and the new one groups tags in a meaningful way. Where it's disabled, the system shall instruct the engine to return flat tags only, and shall flatten any nested tag it returns.
- **14.0.8 (Ubiquitous)**: AI tags shall go into the output frontmatter `tags` only, not inline in the body (Q15).
- **14.0.9 (Unwanted Behavior)**: If the tagging request fails or returns nothing usable, then the system shall still produce the note without AI tags and show a notice.

#### Acceptance Criteria
- **14.1**: With AI tagging off, no tagging request is sent and no vault tag list leaves the device.
- **14.2**: With AI tagging on, the output contains between the minimum and maximum number of AI tags (after dedup against source tags), from a fixture model that returns 10.
- **14.3**: With "Existing tags only" on, a fixture model's invented tag is discarded.
- **14.4**: With a vault containing `ai/llm`, the tagging request includes the `ai/` prefix.
- **14.5**: With "Hierarchical prefixes" off, a returned `ai/agents` is written flat in the resolved format (`ai-agents` in kebab-case).
- **14.6**: A failed tagging request still produces the note, with a notice.

### REQ-15: Built-in templates

**User Story**: As a new user, I want good templates that work out of the box, so that I get value before writing my own.

- **15.0.1 (Ubiquitous)**: The system shall ship these built-in templates:
  - **Comprehensive summary.** Adapted from the YouTube Video Summarizer's default prompt, with these sections: Summary, Key points, Technical terms (as `[[wikilinks]]`, left out when there are none), Actionable insights, Conclusion. It omits the transcription-error guidance.
  - **Key points / TL;DR.**
  - **Action items.** An Obsidian `- [ ]` checklist, with owners and due dates when the note states them.
  - **Flashcards.** One card per line in the single-line `Question::Answer` format of the Spaced Repetition community plugin, with a `flashcards` tag added to the note through the tag pipeline (Q12).
  - **Literature note.**
- **15.0.2 (Ubiquitous)**: Every built-in template's prompt shall include the shared "Reading the source note" guidance (Q2). It tells the model to:
  - use frontmatter as context, not summarize it
  - expand obvious shorthand and fix obvious typos
  - write fragments out as full statements only when their meaning is clear
  - add no facts, names or numbers that aren't in the note, and say where the note is ambiguous
  - keep existing `[[wikilinks]]` and the note's own spelling of names and terms
- **15.0.3 (Ubiquitous)**: The system shall let the user run a built-in template unchanged, or duplicate it into an editable user template.
- **15.0.4 (Event-Driven)**: When a release updates a built-in template, the system shall update the user's copy only if the user hasn't edited it.
- **15.0.5 (Ubiquitous)**: Built-in templates shall rely only on built-in safe defaults for any setting they don't set themselves, so that they need no configuration beyond an engine.
- **15.0.6 (Where)**: Where the source note's frontmatter has `source`, `author` or `published`, as Web Clipper clippings do, the Literature note built-in shall carry those properties into the output note. They're typed as Web Clipper types them: `source` as text, `author` as a list, `published` as a date (Q26).
- **15.0.7 (Ubiquitous)**: Every built-in template shall add a `created` property set to the current date (Q26).
- **15.0.8 (Ubiquitous)**: Built-in templates shall leave out any property whose value resolves to empty, rather than writing it blank (Q26).

#### Acceptance Criteria
- **15.1**: A fresh install with one engine configured lists all five built-in templates, and each runs successfully on a sample note.
- **15.2**: The Comprehensive summary output contains the Summary, Key points, Actionable insights and Conclusion sections.
- **15.3**: Each built-in prompt contains the "Reading the source note" guidance.
- **15.4**: Duplicating a built-in creates an editable copy, and the built-in stays available.
- **15.5**: After an update ships a new version of a built-in, an unedited copy shows the new prompt and an edited copy keeps the user's prompt.
- **15.6**: Flashcards output is lines of `Question::Answer`, and the note has the `flashcards` tag.
- **15.7**: Running Literature note on a Web Clipper clipping with `source`, `author: "[[Ada Lovelace]]"` and `published: 2026-03-01` produces a note with the same three properties and their types.
- **15.8**: Running Literature note on a note without those properties produces no empty `source`, `author` or `published` properties.
- **15.9**: Every built-in's output has a `created` property with the run's date.

### REQ-16: Long notes

**User Story**: As a user, I want a warning before sending a note that's too long for the model, so that I don't waste a request or get a silently cut result.

- **16.0.1 (Event-Driven)**: When the user runs, the system shall estimate the size of each request the run will send (the main prompt and the inline prompt request, REQ-21) and compare each with the resolved engine's context window (Q20).
- **16.0.2 (Unwanted Behavior)**: If the estimate is over the context window, then the system shall warn before sending, show the estimate and the limit, and let the user continue or cancel.
- **16.0.3 (Ubiquitous)**: The system shall never shorten the note's content silently.
- **16.0.4 (Unwanted Behavior)**: If the engine's context window is unknown, then the system shall send without a warning and say in the engine settings that it can't warn for that engine.

#### Acceptance Criteria
- **16.1**: A note larger than a test engine's configured context window triggers the warning before any request is sent.
- **16.2**: Choosing "Cancel" sends nothing. Choosing "Continue" sends the full note.
- **16.3**: An engine with no known context window shows the "can't warn" hint in settings.

### REQ-17: Mobile

**User Story**: As a mobile Obsidian user, I want the plugin to work on my phone, with only the impossible parts turned off, so that I can derive notes anywhere.

- **17.0.1 (Ubiquitous)**: The system shall run on Obsidian desktop and mobile.
- **17.0.2 (State-Driven)**: While running on mobile, the system shall disable features that can't work there, at least LM Studio detection, and explain why where the feature would appear.
- **17.0.3 (State-Driven)**: While running on mobile, the system shall still allow running templates, previewing, and creating notes with any reachable engine.

#### Acceptance Criteria
- **17.1**: On mobile, the core flow (open popup → run → preview → save) works with a cloud engine.
- **17.2**: On mobile, "Detect LM Studio" is hidden or disabled with an explanation.

### REQ-18: Privacy and credentials

**User Story**: As a privacy-conscious user, I want to know when my notes leave my device and to have my API keys protected, so that I can trust the plugin.

- **18.0.1 (Ubiquitous)**: The popup shall show whether the resolved engine is local (for example, a localhost endpoint) or remote, before the user runs.
- **18.0.2 (Ubiquitous)**: The system shall send note content only to the resolved engine, and to no other service.
- **18.0.3 (Ubiquitous)**: The system shall never write API keys into notes, generated output, logs or error messages.
- **18.0.4 (Ubiquitous)**: The system shall store API keys in Obsidian's secret storage where available. Otherwise it shall store them in the plugin's data and say in settings where they are stored.
- **18.0.5 (Ubiquitous)**: The README and settings shall disclose that note contents are sent to the configured provider, as Obsidian's plugin guidelines require.

#### Acceptance Criteria
- **18.1**: The popup labels a localhost engine as local and a cloud engine as remote.
- **18.2**: An error message from a failed request doesn't contain the API key.
- **18.3**: The README has a network-use disclosure section.

### REQ-19: Usability and accessibility

**User Story**: As a user, I want the popup and settings to feel like a native part of Obsidian and be usable from the keyboard, so that the plugin is comfortable to use daily.

- **19.0.1 (Ubiquitous)**: The popup and settings shall use Obsidian's theme variables and components, so they match light, dark and community themes.
- **19.0.2 (Ubiquitous)**: Every popup action shall be reachable by keyboard, with a visible focus state.
- **19.0.3 (Ubiquitous)**: The popup shall remember the last-used template and output location between runs, unless a template command or a template trigger (REQ-22) preselects otherwise.

#### Acceptance Criteria
- **19.1**: The popup is readable and consistent under the default light and dark themes.
- **19.2**: A full run (open → change template → run → save) can be done without a mouse.
- **19.3**: Reopening the popup preselects the template used last time.

### REQ-20: Template import and export

**User Story**: As a user, I want to export and import templates as files, so that I can back them up and share them, as I can with Web Clipper templates (Q19).

- **20.0.1 (Event-Driven)**: When the user exports one or more templates, the system shall save them as a JSON file.
- **20.0.2 (Event-Driven)**: When the user imports a template JSON file, the system shall add its templates as user templates.
- **20.0.3 (Ubiquitous)**: Exported templates shall never contain API keys or other engine credentials. A template's engine is exported by name only.
- **20.0.4 (Unwanted Behavior)**: If an imported template has the same name as an existing one, then the system shall add a number to the imported template's name rather than overwrite.
- **20.0.5 (Unwanted Behavior)**: If an imported file isn't a valid template file, then the system shall reject it with a plain-language reason and change nothing.
- **20.0.6 (Unwanted Behavior)**: If an imported template names an engine that doesn't exist, then the system shall import it anyway and resolve the engine as in 3.0.7.
- **20.0.7 (Ubiquitous)**: The project shall publish **Recipe card**, **Book reference** and **Movie reference** as importable example template files in the repository and documentation. They're adapted from Web Clipper's Recipes, Goodreads and IMDB/Letterboxd templates and use inline prompt variables (REQ-21). They are not built-in templates (Q27).
- **20.0.8 (Ubiquitous)**: The example templates' prompts shall tell the model to leave a property empty when the source note doesn't state it, rather than guess, and they shall leave out empty properties (as in 15.0.8).

#### Acceptance Criteria
- **20.1**: Exporting a template and importing the file into a fresh vault gives an identical template.
- **20.2**: An exported file contains no API key, even when the template's engine has one.
- **20.3**: Importing a template named "Summary" when "Summary" exists creates "Summary 1".
- **20.4**: Importing a malformed file shows an error, and the template list is unchanged.
- **20.5**: Each example template file imports without errors and runs on a matching sample note: a rough recipe, a note about a book, a note about a film.
- **20.6**: Running Book reference on a note that names a book's title and author but not its year produces `title` and `author` properties and no `year` property.

### REQ-21: Inline prompt variables

**User Story**: As a template author, I want to embed small prompts directly in a template's properties, filename or body, as Web Clipper's Interpreter allows, so that one run can fill individual fields (such as a `description` property) as well as, or instead of, producing a whole note (Q24).

- **21.0.1 (Ubiquitous)**: The system shall recognize inline prompt variables written as `{{"prompt text"}}`, optionally followed by filters (`{{"prompt text"|filter}}`). They may appear in property values, the filename pattern and the body wrapper, following Web Clipper's Interpreter syntax.
- **21.0.2 (Event-Driven)**: When a run's template contains inline prompt variables, the system shall answer all of them in one request to the resolved engine, separate from the main prompt's request. It shall send the template's resolved prompt context with that request.
- **21.0.3 (Ubiquitous)**: The prompt context shall be a template setting that may use variables and filters (REQ-6, REQ-7). It defaults to the source note's filename and full contents, so that it matches what the main prompt receives (5.0.5).
- **21.0.4 (Ubiquitous)**: The system shall apply any filters on an inline prompt variable to that prompt's response before placing it.
- **21.0.5 (State-Driven)**: While a template has no main prompt, the system shall send no main generation request, and the AI output variable (6.0.2) shall be empty.
- **21.0.6 (Unwanted Behavior)**: If the inline prompt request fails, or its response lacks an answer for a prompt, then the system shall resolve each unanswered variable to an empty string, show a notice naming them, and still produce the note.
- **21.0.7 (Unwanted Behavior)**: If an inline prompt variable appears inside the main prompt or the prompt context, then the system shall flag it as an error in the template editor, and at run time shall treat it as literal text.
- **21.0.8 (Ubiquitous)**: A template without inline prompt variables shall cause no inline prompt request, so the built-in safe defaults still need no inference beyond the main prompt (5.0.4).
- **21.0.9 (Ubiquitous)**: Inline prompts in property values shall go through the same rules as other property values, including the tag pipeline when they fill `tags` (REQ-11 to REQ-14).

#### Acceptance Criteria
- **21.1**: A template with property `description: {{"a one-sentence description"}}` produces a note whose `description` holds the engine's answer.
- **21.2**: A template with three inline prompts sends exactly one inline prompt request, whatever the number of prompts.
- **21.3**: `{{"three key phrases"|lower}}` places the response in lowercase.
- **21.4**: A template with only inline prompts and no main prompt sends no main generation request, and its note is built from the body wrapper and properties alone.
- **21.5**: Changing a template's prompt context to `{{body}}` sends only the note body, without frontmatter, with the inline prompt request.
- **21.6**: When a fixture engine omits the answer to one of two prompts, that variable is empty, a notice names it, and the other prompt's answer is placed.
- **21.7**: `{{"summarize"}}` written inside the main prompt is flagged in the template editor.
- **21.8**: A template without inline prompts sends no inline prompt request.

### REQ-22: Template triggers

**User Story**: As a user, I want the popup to pick the right template for the note I'm on, by its tags, folder, properties, title or contents, so that I don't choose it by hand each time, as Web Clipper's template triggers do for web pages (Q30).

- **22.0.1 (Ubiquitous)**: A template may list triggers, one per line. Each trigger is one of:
  - `#tag`: the note has the tag, in its frontmatter or inline. A trigger also matches nested tags under it, so `#project` matches `project/beta`. Case is ignored.
  - `folder:<path>`: the note is in that folder or a folder inside it.
  - `property:<key>` or `property:<key>=<value>`: the note's frontmatter has the key, or has it with that value. Values compare ignoring case, and a list value matches if any item does.
  - `title:/<regex>/<flags>`: the regular expression matches the note's filename without extension.
  - `content:/<regex>/<flags>`: the regular expression matches the note's full contents.
- **22.0.2 (Event-Driven)**: When the popup opens on a source note and no template command chose the template, the system shall preselect the first template, in template order, that has a trigger matching the note (Q31).
- **22.0.3 (Ubiquitous)**: The system shall choose the popup's template in this order: a template command, then a matching trigger, then the last-used template (19.0.3), then the first template (Q32).
- **22.0.4 (Ubiquitous)**: When a trigger chose the template, the popup shall show which trigger matched.
- **22.0.5 (Event-Driven)**: When the user changes the source note in the popup, the system shall apply the triggers to the new note, unless the user has already chosen a template in that popup.
- **22.0.6 (Unwanted Behavior)**: If a trigger line can't be read, or its regular expression is invalid, then the system shall flag it in the template editor and ignore it when matching.
- **22.0.7 (Ubiquitous)**: Triggers shall only preselect a template. They never run one.
- **22.0.8 (Ubiquitous)**: The system shall let the user reorder templates in settings, which sets the order triggers are matched in.

#### Acceptance Criteria
- **22.1**: A template with trigger `folder:Meetings` is preselected when the popup opens on `Meetings/2026-10-14 launch sync.md`, and isn't when it opens on `Reading/dune-notes.md`.
- **22.2**: `#project` matches a note tagged `project/beta`, in frontmatter or inline. It doesn't match `projects`.
- **22.3**: `property:type=book` matches a note with `type: Book`. `property:source` matches any note with a `source` property.
- **22.4**: `title:/^\d{4}-\d{2}-\d{2}/` matches `2026-10-01.md`, and `content:/recipe/i` matches a note containing "Recipe".
- **22.5**: When two templates match a note, the one higher in the template list is preselected. Moving the other above it changes the preselection.
- **22.6**: "Derive with Action items" opens with Action items selected even when another template's trigger matches the note.
- **22.7**: For a template chosen by a trigger, the popup shows the trigger, such as "Matched folder:Meetings".
- **22.8**: A trigger with an invalid regular expression, such as `title:/[/`, is flagged in the template editor, and the popup still opens and matches the template's other triggers.
- **22.9**: Changing the source note in the popup re-applies triggers. After the user picks a template in that popup, changing the source note keeps their pick.
- **22.10**: Exporting and importing a template keeps its triggers.

## 3. Open Questions

Each question has a stable ID, continuing from `product.md`. When a question is answered, its ID is retired and never reused. Q23–Q25 came from the `tech.md` review, Q26–Q27 from the [Web Clipper template findings](../../analysis/web-clipper-templates/findings.md), and Q28–Q29 and Q33–Q35 from implementation, and Q30–Q32 from a feature request during implementation.

There are no open questions right now.

**Answered:**

| ID | Question | Decision | Where |
|---|---|---|---|
| Q12 | Flashcard format | `Question::Answer` (Spaced Repetition plugin) plus a `flashcards` tag | 15.0.1 |
| Q13 | Prompts that don't include the note | Append the filename and full contents after the prompt | 5.0.5 |
| Q14 | AI tagging request | A separate request after the main one | 14.0.2 |
| Q15 | Where AI tags go | Frontmatter `tags` only | 14.0.8 |
| Q16 | Source link format | Follow the vault's link settings | 10.0.5 |
| Q17 | Built-in safe defaults | As listed | 5.0.4 |
| Q18 | AI output with its own frontmatter | Merge it into the note, template properties win, tags go through the pipeline | 8.0.7 |
| Q19 | Template import and export | JSON files, with no credentials | REQ-20 |
| Q20 | Context window source | Per-engine setting, auto-filled where reported | 3.0.9, REQ-16 |
| Q21 | Per-template commands | One "Derive with &lt;template&gt;" command each | 1.0.3 |
| Q22 | Streaming into the preview | Yes, where supported; cancelling discards the partial output | 8.0.3, 8.0.4 |
| Q23 | Importing Web Clipper templates | No. Every reviewed template depends on web-page variables that a vault note doesn't have ([findings](../../analysis/web-clipper-templates/findings.md)) | — |
| Q24 | Web Clipper-style inline prompt variables | Yes | REQ-21 |
| Q25 | API keys for OpenAI-compatible engines and LM Studio | Optional Bearer key; LM Studio detection handles authentication | 3.0.10, 4.0.7, 4.0.8 |
| Q26 | Clipping-aware built-in templates | Literature note carries `source`, `author` and `published` over; every built-in adds `created`; empty properties are left out | 15.0.6–15.0.8 |
| Q27 | Example templates adapted from Web Clipper | Recipe card, Book reference and Movie reference ship as importable examples, not built-ins | 20.0.7, 20.0.8 |
| Q28 | Frontmatter `tags` written as one string | Split it on commas and spaces, rather than following Obsidian, which reads such a string as no tags | 11.0.4 |
| Q30 | Picking templates automatically | Template triggers, as in Web Clipper: tag, folder, property, title regex and content regex | REQ-22 |
| Q31 | When several templates' triggers match | The first in template order; templates can be reordered | 22.0.2, 22.0.8 |
| Q32 | Trigger priority | Template command, then trigger, then last-used template, then the first template; the popup shows the matched trigger | 22.0.3, 22.0.4 |
| Q33 | Reasoning models | Strip `<think>` reasoning from responses; explain an output limit spent on reasoning | 8.0.8, 8.0.9 |
| Q34 | Output limit when none is set | Send none, so the provider's default applies, except Anthropic, which requires one: 8,192 | 3.0.11 |
| Q35 | LM Studio context length | Read the loaded length for the warning and show it; optionally load the model with the engine's context window before a run | 4.0.9, 4.0.10 |
| Q29 | Real-model verification (TASK-23) | The user enters API keys and the LM Studio token in a sandboxed test vault, so they never pass through the conversation, and the agent runs the templates | TASK-23 |

The next new question is Q36.
