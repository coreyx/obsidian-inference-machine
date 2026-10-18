# Inference Machine

Derive a new note from an existing one with an AI model. Pick a note, pick a template, and Inference Machine sends the note to the model you've set up, then creates the result as a new note: in a folder you choose, or next to the original. Think [Obsidian Web Clipper](https://obsidian.md/clipper), but for notes already in your vault.

- **Set up an engine once** (Anthropic, OpenAI, Google Gemini, LM Studio or any OpenAI-compatible server) and reuse it with every template.
- **Templates** decide the prompt and the note it produces: filename, frontmatter properties, body and location. They use the same variables, filters and inline prompts as Web Clipper templates.
- **Tags are handled carefully.** The source note's tags are carried over, every tag appears only once however it's spelled, and AI tagging (off by default) can suggest tags that fit your vault.
- **Nothing is saved until you say so.** The preview shows the exact note that will be created, and you can edit it first.
- Works on desktop and mobile. Requires Obsidian 1.13.4 or later.

## Getting started

1. Install the plugin and enable it.
2. Open **Settings → Inference Machine** and add an engine (see [Engines](#engines)).
3. Open a note, then click the sparkles icon in the ribbon or run **Inference Machine: Open** from the command palette.
4. Choose a template, click **Run**, check the preview, and click **Save**.

Every template also has its own command, such as **Inference Machine: Derive with Comprehensive summary**, which opens the popup with that template selected. Assign it a hotkey to derive a note in two keystrokes.

In the popup, `Ctrl+Enter` (`Cmd+Enter` on macOS) runs the template, and again saves the preview. `Esc` cancels or closes. Closing the popup at any point writes nothing.

## Engines

An engine is a provider, a model and its settings. You can save several, choose one as the default, set an engine per template, and switch engines in the popup for a single run.

| Provider | What you need |
|---|---|
| **Anthropic** | An API key from the [Anthropic Console](https://console.anthropic.com/) and a model ID such as `claude-sonnet-5-5`. |
| **OpenAI** | An API key from the [OpenAI platform](https://platform.openai.com/) and a model ID. |
| **Google Gemini** | An API key from [Google AI Studio](https://aistudio.google.com/) and a model ID such as `gemini-2.5-flash`. |
| **OpenAI-compatible** | The server's base URL, usually ending in `/v1` (for example `http://localhost:11434/v1` for Ollama). An API key is optional: it's sent as a Bearer token only when you set one. |

**List models** fetches the provider's models, and **Test** sends a tiny request to check that the engine works. The **context window** is filled in automatically where the provider reports it, or from a list of known models. With it set, Inference Machine warns you before sending a note that looks too long for the model. It never shortens a note.

**Maximum output tokens** is optional. Left empty, the provider's or model's own limit applies, except for Anthropic, which requires one and gets 8,192.

**Reasoning models** work too. Working a model writes between `<think>` and `</think>` is removed before anything reaches your note. If a model spends its whole output limit reasoning and writes no answer, the error says so, so you know to raise the limit or leave it empty.

### LM Studio

Start LM Studio's local server (**Developer → Start Server**), then click **Detect LM Studio** in the settings. Inference Machine finds the server, lets you choose a model (a loaded one is preselected) and sets up the engine. Detecting again updates that engine rather than adding a second one.

- **Authentication:** if LM Studio's "Require authentication" setting is on, detection asks for an API token. Create one in LM Studio under **Developer → Server Settings → Manage Tokens**.
- **Streaming:** to see the output as it's written, turn on **Enable CORS** in LM Studio's server settings. Without it, everything still works, but the output appears when it's complete.
- **Context length:** LM Studio loads a model at its own default length, whatever the engine's context window says. The engine's settings show the length the model is loaded with, and the long-note warning uses the smaller of the two. To have Inference Machine set it, choose **Load the model with this context window** under **Context length in LM Studio**: before each run, the model is reloaded at the engine's context window if LM Studio has it at another length. The popup shows "Loading the model in LM Studio…" while that happens.
- **Speed:** a model runs much more slowly when it and its context don't fit in your GPU's memory together. If runs are slow, try a smaller context window, or close other programs that use the GPU.
- **Mobile:** LM Studio runs on a computer, so it can't be detected from a phone. Add an OpenAI-compatible engine with your computer's network address instead, such as `http://192.168.1.20:1234/v1`.

## Templates

Inference Machine comes with five built-in templates:

| Template | What it makes |
|---|---|
| **Comprehensive summary** | Summary, Key points, Technical terms as `[[wikilinks]]`, Actionable insights and Conclusion. |
| **Key points / TL;DR** | A one- or two-sentence TL;DR and the key points. |
| **Action items** | Tasks as a `- [ ]` checklist, with owners and due dates when the note gives them, plus decisions and open questions. |
| **Flashcards** | `Question::Answer` cards for the [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin, tagged `flashcards`. |
| **Literature note** | A note on the work the source covers. A Web Clipper clipping's `source`, `author` and `published` properties are carried over. |

All of them tell the model to read the note carefully: use frontmatter as context, expand obvious shorthand, add nothing the note doesn't say, and keep your `[[links]]` and spelling. They also add a `created` date and leave out empty properties.

Run a built-in as it is, or duplicate it and edit the copy. When an update improves a built-in, copies you haven't edited are updated, and edited ones are left alone. Deleted built-ins can be restored from the settings.

### What a template sets

Every setting below is optional. A template that leaves one unset uses the default from the plugin's settings.

- **Main prompt:** what the model is asked to write. If it doesn't use `{{content}}` or `{{body}}`, the note's filename and full contents are added after it.
- **Filename**, **body** (with `{{output}}` where the main output goes) and **properties** (frontmatter for the new note, each with a type).
- **Location:** a folder, or next to the source note. Missing folders are created. A taken name gets a number (`Alpha - Summary 1`); nothing is ever overwritten.
- **Engine**, **skip preview**, **open the new note**, and a **link back to the source** under a heading (`# References` by default). The link follows your vault's link settings.
- **Tag settings**, including preferred tags for AI tagging.
- **Triggers:** rules that preselect the template in the popup (see below).

### Triggers

Like Web Clipper's template triggers, a template can list rules, one per line, that pick it automatically for matching notes:

| Rule | Matches a note that |
|---|---|
| `#reading` | Has the tag `reading`, or a tag nested under it such as `reading/books` |
| `folder:Meetings` | Is in `Meetings` or a folder inside it |
| `property:type` | Has a `type` property |
| `property:type=book` | Has `type` set to `book` |
| `title:/^Meeting/i` | Has a filename matching the regular expression |
| `content:/TODO/` | Has contents matching the regular expression |

When you open the popup, the first template in your list with a matching rule is selected, and the popup says which rule matched. Reorder templates in the settings to change which wins. A **Derive with** command always uses its own template, and a template you pick yourself stays selected when you change the source note. The template editor points out any line it can't read.

### Variables

| Variable | Value |
|---|---|
| `{{title}}` | The source note's filename, without `.md` |
| `{{content}}` | The full note, frontmatter included |
| `{{body}}` | The note without its frontmatter |
| `{{frontmatter}}` | The frontmatter's YAML text |
| `{{properties.author}}`, `{{properties["key with spaces"]}}` | One frontmatter value |
| `{{path}}`, `{{folder}}` | The note's path and folder |
| `{{created}}`, `{{modified}}` | The note's creation and modification times |
| `{{date}}`, `{{time}}` | The current date (`YYYY-MM-DD`) and time (`HH:mm`) |
| `{{template}}` | The template's name |
| `{{output}}` | The main AI output (filename, body and properties only) |

A missing value is empty. The template editor flags names it doesn't recognize.

### Filters and logic

Templates use [knap](https://knap.md), the template engine behind Web Clipper, so its [filters](https://knap.md/filters) and [logic](https://knap.md/logic) work here as they do in [Web Clipper](https://help.obsidian.md/web-clipper/filters). For example, `{{title|lower}}`, `{{properties.tags|join:", "}}` or `{{properties.missing|default:"n/a"}}`. A filter that can't run leaves the value as it is, and the preview says so.

### Inline prompts

Like Web Clipper's Interpreter, a template can ask the model small questions right where the answer goes:

```
description: {{"a one-sentence description of the note"}}
phrases: {{"three key phrases"|lower}}
```

All of a template's inline prompts are answered in one extra request. Filters apply to the answers. A template can use inline prompts with a main prompt or instead of one. Inline prompts work in the filename, properties and body, but not in the main prompt itself.

### Importing and exporting

Templates can be exported to a JSON file, or copied to the clipboard, and imported into another vault. Exported files name a template's engine but never contain an API key.

The [`examples`](examples) folder has three templates to import: **Recipe card**, **Book reference** and **Movie reference**. They fill properties such as author and year with inline prompts, and tell the model to leave a property empty rather than guess.

## Tags

- **Source tags:** the source note's frontmatter tags and inline `#tags` are added to the new note, spelled as you wrote them (a `tags` value written as one string, such as `"alpha, beta"`, is split into separate tags).
- **One of each:** `#Project` and `#project`, or `machine-learning`, `machine_learning` and `machineLearning`, are one tag. The spelling kept is the source note's first, then the template's, then the AI's.
- **Valid every time:** spaces become the format's separator, characters Obsidian doesn't allow are removed, and tags that can't be made valid, such as `1984`, are left out and listed in the preview.
- **AI tagging (off by default):** the engine suggests tags in a separate request. By default it's shown your vault's existing tags, so it reuses them, and their group prefixes such as `ai/`. You can set the tag format (kebab-case by default, snake_case, camelCase, PascalCase or a custom format described in your own words), how many tags to ask for, and whether to allow only tags already in your vault.

## Network use and privacy

Inference Machine only connects to the network when you run a template, test an engine, list models or detect LM Studio, and only to the engine you configure.

- **What's sent:** the source note's filename and full contents, including its frontmatter, go to the engine you choose, and to no other service. With AI tagging on, your vault's tag names are sent too.
- **Who receives it:** a remote engine's provider (Anthropic, OpenAI, Google, or the server you configured) receives it under their terms. A local engine such as LM Studio keeps everything on your device or network. The popup labels each engine **Local** or **Remote** before you run.
- **API keys** are kept in Obsidian's secret storage, never in the plugin's settings file, and never written into notes or error messages. Secret storage stays on the device, so **enter your keys again on each device** you use.

## Development

```sh
npm install
npm run dev        # rebuild main.js on change
npm run build      # type-check and build for release
npm run lint
npm test           # unit tests with coverage
npm run test:e2e   # end-to-end tests in real Obsidian (downloads Obsidian into .obsidian-cache)
npm run vault      # open test/vault in a sandboxed Obsidian with the plugin hot-reloading
```

The design and requirements live in [`spec/obsidian-inference-machine`](spec/obsidian-inference-machine).

## License

[MIT](LICENSE)
