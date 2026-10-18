# Pre-release verification: Obsidian Inference Machine

Results of TASK-23 in [`tasks.md`](./tasks.md): every built-in and example template run against real models, plus the LM Studio, theme and settings checks that automated tests can't cover. Criteria numbers refer to [`requirements.md`](./requirements.md).

Runs used the demo vault (`demo/vault`) in Obsidian 1.14.4 on Windows 11, with the plugin built from `feat/inference-machine-v1`. API keys and the LM Studio token were entered by the user in that vault's secret storage and never left it. LM Studio ran on an RTX 5090 (32 GB).

## Engines

| Engine | Provider type | Model | Context window | Test (3.1) |
|---|---|---|---|---|
| OpenAI | OpenAI | `gpt-5.4-nano` | 400,000 | Passed |
| Anthropic | Anthropic | `claude-haiku-5-5` | 200,000 | Passed |
| Gemini | Google Gemini | `gemini-3.8-flash` | 1,048,576 | Passed |
| LM Studio | OpenAI-compatible, made by detection, with a token | `qwen3.6-27b-fable-fusion-711-uncensored-heretic-nm-dau-neo-max-mtp`, a reasoning model | 16,384 | Passed |

No engine had a maximum output tokens setting, so each provider used its own limit (Anthropic gets 8,192).

## Template runs

Nine runs per engine: the five built-ins, Literature note on a second source with no clipping properties, and the three example templates. Each output was checked for the marks below and for a `created` property.

| Template | Source note | Checks |
|---|---|---|
| Comprehensive summary | Clippings/How engines work | Summary, Key points, Actionable insights and Conclusion sections (15.2) |
| Key points / TL;DR | Notes/spaced repetition | A TL;DR |
| Action items | Meetings/2026-10-14 launch sync | A checklist |
| Flashcards | Notes/spaced repetition | At least three `::` cards and the `flashcards` tag |
| Literature note | Clippings/How engines work | `source`, `author` as a list of links, `published` carried over |
| Literature note | Reading/dune-notes | No empty clipping properties written |
| Recipe card | Kitchen/pancakes | An ingredient checklist, `servings: 8` |
| Book reference | Reading/dune-notes | Title and author; no invented year (20.5, 20.6) |
| Movie reference | Films/arrival-notes | Title and director; no invented year (20.5, 20.6) |

### Results

| Engine | Passed | Streaming (8.5) | Notes |
|---|---|---|---|
| OpenAI | 9 of 9 | Yes: 86 to 296 chunks per main output | 1 to 2 seconds per run |
| Anthropic | 9 of 9 | Yes: 22 to 164 chunks | 1 to 6 seconds per run |
| Gemini | 9 of 9 | Yes: 5 to 17 chunks | Two runs were first reported as cancelled, because the popup was being used at the same time and shares the run. Both passed when run again. One Action items run took 60 seconds. |
| LM Studio | 9 of 9 | Yes: 82 to 393 chunks | See "Reasoning model" below |

The three example templates have no main prompt, only inline prompts, so they send one non-streaming request and show no chunks. That's expected.

### Reasoning model (8.0.8, 8.0.9, 3.0.11)

The first LM Studio pass, before Milestone 7, used `glm-4.7-flash-uncensored-heretic-neo-code-imatrix-max` with a 1,500-token output limit and passed 3 of 9. The model spent the whole limit reasoning: a probe showed 1,500 of 1,500 completion tokens were reasoning, with empty content. That gave "returned an empty response" failures, inline prompts left empty, and one note that kept about 28,000 characters of `<think>` text.

After Milestone 7, the set was run again with a reasoning model and no output limit. All 9 passed. No `<think>` text reached any note, and no run hit an output limit.

| Run | Context loaded | Time |
|---|---|---|
| Comprehensive summary | 65,536 | 22 min |
| Key points / TL;DR | 65,536 | 17 min |
| Action items | 65,536 | 44 min |
| Flashcards | 65,536 | 48 min |
| Recipe card | 16,384 | 44 s |
| Literature note, How engines work | 16,384 | 34 s, including an 11 s reload |
| Literature note, dune-notes | 16,384 | 50 s |
| Book reference | 16,384 | 22 s |
| Movie reference | 16,384 | 23 s |

The slow runs were the GPU, not the plugin. At 65,536 tokens the model's context cache, plus two ComfyUI instances on the same card, didn't fit in VRAM. At 16,384 the same model answered in under a minute. Two runs at 65,536 were redone at 16,384: one was cancelled when a second run started in the same Obsidian, and one ended with "LM Studio reported an error: terminated" when the model was reloaded in LM Studio mid-answer. That message is LM Studio's own, passed through as designed.

## LM Studio context length (REQ-4, TASK-29)

| Criterion | What was done | Result |
|---|---|---|
| 4.7 | "Let LM Studio decide", context window 65,536, model loaded at 32,768, a note of 160,029 characters | The long-note warning appeared with an estimate of 46,036 tokens and a limit of 32,768. Cancel sent nothing. |
| 4.8 | "Load the model with this context window" through the popup, from 65,536 to 32,768, and in later runs to 65,536 and to 16,384 | The popup's first row read "Loading the model in LM Studio…", then "Model loaded in LM Studio". Each reload took 11 to 12 seconds, and LM Studio then reported the new length. |
| 4.9 | Opened the LM Studio engine's settings | "LM Studio has this model loaded at 32,768 tokens", and later 16,384, under the context length choice |

## LM Studio detection (4.1, 4.5)

| Case | Result |
|---|---|
| Authentication on, token stored on the engine | Detect reused the stored token and listed 12 models, with the loaded one marked and preselected. "Use this model" updated the existing engine instead of adding a second one, and kept the context window the user set. Test passed. |
| Authentication on, no token linked yet | With the engine's token link removed, Detect showed "LM Studio needs an API token" with where to create one (4.0.7). Connect with nothing picked said "Pick a stored token or paste a new one." Picking the stored token through **Link…** opened the model chooser, and the engine was updated with the token linked again. Test passed. |
| Authentication off, no token | With "Require authentication" turned off in LM Studio and no token linked, Detect found the server without asking for one and listed the models, with the loaded one preselected. "Use this model" updated the existing engine without a token, in 3 seconds from the click. Test passed without a token. The token was linked again afterwards, for when authentication is turned back on. |

## Themes (19.1)

The popup's form and preview, and the engine form in the settings window, were checked under Obsidian's default dark and light themes and the Minimal community theme (9.1.4) in dark and light. Text, descriptions, controls and the preview editor were readable in all four, and the buttons took each theme's accent color. Nothing overlapped or was cut off.

## Model-behavior gaps

None that need a prompt fix before release. Every template's checks passed on all four engines, and the example templates left unknown properties empty instead of inventing them.

## Follow-ups

- The popup shares one run with every other way of starting a run. Starting a second run cancels the first, and closing the popup can cancel a run that a script or command started. That's by design (design.md, run controller), but worth knowing when testing.
- Large context windows on local models can be much slower if the model and its cache don't fit in GPU memory. The README could say so next to the LM Studio context length setting.
