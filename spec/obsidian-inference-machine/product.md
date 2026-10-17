# Product: Obsidian Inference Machine

An Obsidian plugin that takes a note, runs it through an AI model using a reusable template, and creates a new note from the result somewhere else in the vault. It works like [Obsidian Web Clipper](https://obsidian.md/clipper), except the source is a note in the vault instead of a web page.

## Problem and motivation

Obsidian users often want to make new notes out of notes they already have: a summary of a long meeting note, flashcards from lecture notes, an action-item list from a journal entry, a cleaned-up version of a rough draft, a literature note from a clipped article. Doing this with AI today usually goes one of two ways:

- **Copy and paste into a chat app.** Copy the note, paste it into ChatGPT, Claude or Gemini, retype or paste the prompt, copy the answer back, make a new file, fix the frontmatter, add tags. It is slow, the prompt is rewritten every time, and the frontmatter and tags come out inconsistent.
- **General-purpose AI plugins.** These are mostly chat sidebars or in-place text generators. They aren't built around one job: take this note, apply this prompt, put the result here, with these properties and tags.

Obsidian Web Clipper already solved this problem for web pages. You configure it once, keep a library of templates, and each template decides what to extract, how to shape it, and where the note goes. Nothing like that exists for notes that are already in the vault. This plugin fills that gap.

## Target users

- **Obsidian power users who already use Web Clipper templates.** They know the pattern (templates, variables, filters, target folders) and want it for their existing notes. The plugin should feel familiar to them right away.
- **Knowledge workers and researchers who process notes over and over.** They turn raw notes (meetings, reading, research, journals) into refined notes (summaries, literature notes, task lists, study material) the same way every time, so a saved template pays off quickly.
- **Privacy-conscious and local-model users.** They want to run everything against a local model, especially through LM Studio, so note contents never leave their machine.

## Value proposition

- **Useful out of the box.** The plugin ships with built-in templates, starting with a comprehensive summary, so a new user can derive a good note before writing any template of their own.
- **Set it up once, reuse it everywhere.** The inference engine (provider, model, credentials) is configured one time. After that, any note can be processed with any template into any folder in a couple of clicks.
- **Templates instead of retyped prompts.** Prompts are saved and named. Variables pull frontmatter values into the prompt, and filters do light processing on text and frontmatter, so one template works across many notes.
- **Your choice of model, local included.** Anthropic, OpenAI and Gemini work directly, and any OpenAI-compatible API works too. A one-click LM Studio detector finds a local LM Studio instance and configures the plugin to use it, so no setup is needed for local inference.
- **Clean output notes.** The new note lands in the right place (a chosen folder or next to the source note) with tidy frontmatter. Tags are handled carefully: optional AI-suggested tags, tags carried over from the source note, and never the same tag twice.
- **The source note is left alone.** The plugin creates a new note and never changes the original.

## Goals and success criteria

*The goals come from the original brief. The specific targets are proposals to confirm or adjust.*

- **Two clicks to a derived note.** With a template already set up, a user on any note can go from the ribbon button or a command to a created note without retyping anything: open the popup, check the prefilled source note, pick a template, run.
- **Value before writing a template.** Right after engine setup, a new user can run a built-in template (such as Comprehensive summary) on any note and get a well-structured result without writing or editing a prompt.
- **One-time engine setup.** A new user can configure a working engine in a few minutes. For LM Studio, one click on "Detect LM Studio" (with the LM Studio server running) leads to a successful test request with no manual URL or model entry.
- **Every provider path works.** Anthropic, OpenAI, Gemini, and at least one generic OpenAI-compatible endpoint (LM Studio counts) can each run the same template and produce a valid note.
- **Correct tags every time.** No generated note ever has a duplicate tag in its frontmatter. When tag merging is on, every tag from the source note shows up in the output, from both its frontmatter and its inline `#tags`, spelled the way the source spells it. When AI tagging is on, AI-suggested tags are added according to the same dedup rules. Tagging is a correctness area: it should have explicit test coverage and must not depend on the model getting it right.
- **Familiar to Web Clipper users.** Someone who has written Web Clipper templates can write an Inference Machine template without reading much documentation, because variables and filters look and behave alike wherever that makes sense.

## Non-goals

*Proposed boundaries, inferred from the brief. Each is open to revision.*

- **Not a web clipper.** It processes notes that are already in the vault. Pulling content from the web is Web Clipper's job.
- **Not a chat interface.** There is no conversation, no follow-up turns, and no chat history sidebar. Each run is one request that produces one note.
- **Not an in-place editor.** The source note is read and never modified. Output always goes to a new note.
- **Not a vault-wide batch processor (at least at first).** One run processes one source note. Batch runs over a folder or a search are a future goal (Q10).
- **Not a model host or proxy.** The plugin calls providers the user already has access to. It does not run models itself, resell API access, or route requests through its own service.
- **Not a general workflow or automation engine.** No chained multi-step pipelines, triggers, or scheduled runs.

## Core user journeys

Named and narrated at a high level only. Screen-level flows belong to `design-direction` once the popup UI is designed.

1. **One-time engine setup.** Install the plugin → open settings → pick a provider (Anthropic, OpenAI, Gemini or OpenAI-compatible) → enter an API key and choose a model, *or* click **Detect LM Studio** to have it find the local instance and fill in the endpoint and model → send a test request → done. Users can save more than one engine, and one of them is the global default. Users rarely come back to this step. The built-in templates work immediately, so the next thing a user does can be journey 3.
2. **Author a template.** In settings, create a template from scratch or duplicate a built-in one → write the prompt, using variables (the note's filename, its contents, specific frontmatter values) and filters (light text and frontmatter processing) → optionally set the output note: filename pattern, frontmatter properties, body wrapper, output location (a specific folder, or next to the source note), tagging behavior (AI tagging on or off, merge source tags on or off), and engine → save. Anything the template leaves unset falls back to the global config. Users build up a small library of templates over time, one per kind of derived note.
3. **Derive a note (the core loop).** While viewing a note, click the ribbon button or run a command → a popup opens with the current note already selected as the source → optionally switch the source note, the template, or the output location → run → the plugin sends the note's filename and full contents (including frontmatter) through the template to the engine → the result appears in a preview editor big enough to read and edit a full note → the user reviews and edits it → save → a new note is created at the target location with merged, deduplicated tags.
4. **Reuse across contexts.** The same engine handles different notes and templates: a meeting note goes through "Action items" into `Tasks/`, a reading note goes through "Literature note" next to the source, and so on. Nothing gets reconfigured; only the template and destination change.

## Built-in templates

The plugin ships with a small set of ready-to-use templates. They are the first thing a new user runs, and they show how to write a good template.

- **Comprehensive summary (the most important one).** Adapted from the default prompt in the YouTube Video Summarizer plugin, as found in the fork [coreyx/obsidian-yt-video-summarizer](https://github.com/coreyx/obsidian-yt-video-summarizer) (`DEFAULT_PROMPT` in `src/defaults.ts`). The plugin was written by [mbramani](https://github.com/mbramani/obsidian-yt-video-summarizer), and the fork is maintained and extended by this product's author. That prompt produces a note with these sections:
  - **Summary:** the main topic and key message.
  - **Key points:** a bullet list.
  - **Technical terms:** each term as a `[[wikilink]]` with an explanation. The section is left out when there are none.
  - **Actionable insights:** practical advice, workflows, best practices, warnings and concrete takeaways a reader could apply.
  - **Conclusion:** a brief wrap-up.

  The built-in version keeps this structure but takes a note as input instead of YouTube subtitles. It drops the summarizer's "correct transcription errors" guidance, which is specific to auto-generated subtitles.
- **Key points / TL;DR.** A short version: a one- or two-sentence TL;DR followed by the key points as bullets.
- **Action items.** Tasks, decisions and follow-ups pulled out of the note as an Obsidian checklist (`- [ ]`). Who owns each item and when it's due are included when the note says so.
- **Flashcards.** Question-and-answer pairs for study (card format: Q12).
- **Literature note.** A structured note on a source the note covers (an article, book, paper or talk): what the source is, its main arguments, key quotes or evidence, and the reader's own takeaways.

All built-in templates share **"Reading the source note"** guidance (Q2). It does for notes what the transcription-error guidance did for subtitles: it tells the model how to read a source that may be rough, made of shorthand, fragments or dictation, and how to use frontmatter as context without inventing anything.

Built-ins can be run as-is or duplicated into an editable copy. When a release improves a built-in, copies the user hasn't edited are updated, and edited copies are kept. See REQ-15 in [Requirements](./requirements.md).

## Market and competitive context

- **The YouTube Video Summarizer plugin** (mbramani's original, as extended in the fork this product's author maintains) is direct prior art. The fork already has multi-provider support (Gemini, OpenAI, Anthropic, LM Studio), the comprehensive summary prompt above, and an AI tagging approach worth carrying over:
  - It gives the model the vault's existing tags and tells it to reuse them before inventing new ones.
  - New tags are lowercase kebab-case. This product makes the format configurable (REQ-13).
  - New tags are nested under group prefixes the vault already uses (such as `ai/`).
  - During dedup, a hierarchical tag wins over its flat equivalent (`ai/machine-learning` over `ai-machine-learning`).

  The Inference Machine generalizes that plugin: any note as the source instead of a video, and many templates instead of one prompt.

- **Obsidian Web Clipper** is the direct inspiration and sets the interaction model this product borrows: a popup, reusable templates, variables, filters, target folders, and an optional AI step (its "Interpreter"). It is limited to web pages. This product takes the same model and points it at vault notes.
- **General AI plugins in the Obsidian community** (chat sidebars, inline text generators, "AI assistant" plugins) cover a lot of AI use but are built around conversation or editing text in place. Few or none focus on *note → template → new note in a chosen place* with careful frontmatter and tag handling. That focus is what sets this product apart.
- **External chat apps** (ChatGPT, Claude, Gemini) are the "do nothing" alternative. They are powerful but have no vault awareness, no saved templates, and no frontmatter or tag handling.

This section is brief on purpose. A closer review of existing community plugins could come before release to confirm the gap.

## Constraints and context

- **Obsidian platform.** It ships as an Obsidian community plugin and must meet Obsidian's community plugin guidelines and review requirements, including clearly disclosing that note contents are sent over the network to third-party services.
- **Privacy and data handling.** Processing a note sends its filename and full contents, frontmatter included, to whichever engine is configured. Users should be able to tell when data leaves their machine (cloud providers) and when it doesn't (local LM Studio). API keys are user secrets and must be treated that way.
- **Bring your own provider.** Users supply their own API keys or local models and pay their own provider costs. The plugin has no backend, billing, or account system.
- **Desktop and mobile.** The plugin runs on Obsidian desktop and mobile. Features that can't work on mobile are disabled there, most obviously LM Studio detection, which needs to reach a server on the same machine. Cloud providers and the core derive-a-note loop work on both.
- **Web Clipper familiarity is a soft constraint.** Where Web Clipper already has a convention for variables, filters or templates, follow it unless there's a good reason not to, so users don't have to relearn.

## Product decisions

These are the product-level decisions. The detailed behavior lives in [Requirements](./requirements.md), and the REQ numbers below point there. Q numbers are the open questions each decision came from.

- **A template defines the whole output note**, not just the prompt. Settings resolve template → global config → built-in safe defaults, and those defaults never need an inference call. (REQ-5)
- **Web Clipper-style variables and filters**, so Web Clipper users feel at home. (REQ-6, REQ-7; Q9)
- **Several engines, one global default.** A template can pick an engine, and the popup can override it for a single run. (REQ-3; Q5)
- **Preview and edit before saving.** The editor is big enough for a full note, and trusted templates can skip it. (REQ-9; Q6)
- **Output never overwrites anything.** New notes link back to their source under a configurable references heading (default `# References`) and open when created. (REQ-10; Q7, Q8)
- **Tags are a correctness area.** The plugin handles them itself and doesn't rely on the model:
  - Source tags, both frontmatter and inline, are merged.
  - Dedup ignores case and word format.
  - The source note's spelling wins.
  - AI tags use a configurable format, kebab-case by default.
  - Every written tag is guaranteed valid in Obsidian.

  (REQ-11 to REQ-13; Q3, Q4)
- **AI tagging is opt-in.** When on, it fits the vault's existing tags and prefixes instead of inventing parallel ones. (REQ-14; Q1)
- **Built-in templates share "Reading the source note" guidance.** (REQ-15; Q2)
- **Long notes trigger a warning and are never cut silently.** (REQ-16; Q11)
- **Mobile is supported**, with what can't work there (LM Studio detection) disabled. (REQ-17)
- **Batch processing is a future goal**, out of scope for the first release. (Q10)

## Open questions for later

Each question has a stable ID. When a question is answered, its ID is retired, never reused, and the outcome is recorded with the ID attached.

There are no product-level questions open. Q1–Q11 are answered above. Requirements-level questions continue from Q12 in [Requirements §3](./requirements.md#3-open-questions).
