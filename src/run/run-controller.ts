import type { App, TFile } from 'obsidian';
import type { ChatRequest, ChatResult } from '../core/chat';
import { composeNote, type ComposedNote } from '../core/compose';
import { sanitizeFilename } from '../core/filename';
import { answerMap, buildInlineRequest, collectTemplatePrompts, parseInlineResponse, unansweredNotice } from '../core/inline';
import type { NoteSnapshot } from '../core/note';
import type { ParseYaml, StringifyYaml } from '../core/output';
import { resolveRunConfig, type PopupOverrides, type RunConfig } from '../core/resolve';
import type { EngineConfig, Template } from '../core/schema';
import type { DroppedTag } from '../core/tags/pipeline';
import { buildTaggingRequest, MAX_VAULT_TAGS, requestAiTags } from '../core/tagging-request';
import { render } from '../core/template/knap';
import { buildMainPrompt } from '../core/template/prompt';
import { buildVariables } from '../core/template/variables';
import { outputLimitMessage, stripReasoning } from '../core/reasoning';
import { checkFits } from '../core/tokens';
import { NormalizedError, type Engine } from '../engines/engine';
import type { LoadedModel } from '../engines/lmstudio';
import { sourceLink } from '../obsidian/links';
import { readNote } from '../obsidian/note-reader';
import { createNote, fileAt, notePath, openNote, outputFolder, planPath } from '../obsidian/note-writer';
import type { SettingsStore } from '../obsidian/settings-store';
import type { VaultTagIndex } from '../obsidian/tag-index';

/**
 * Orchestrates one run (design.md, "A run, end to end"): snapshot the
 * source, resolve settings, build and size-check the requests, send them
 * concurrently, compose the note, and plan where it goes. Nothing touches
 * the vault until `save` (or "Skip preview", which saves on completion).
 */

/** What the controller needs from the plugin. */
export interface RunHost {
	app: App;
	store: SettingsStore;
	engineFor: (config: EngineConfig) => Engine;
	tagIndex: VaultTagIndex;
	yaml: { parse: ParseYaml; stringify: StringifyYaml };
	now?: () => Date;
	/** LM Studio's native API, for engines made by detection (4.0.9, 4.0.10). */
	lmStudio?: LmStudioControl;
}

/** Reads and sets how LM Studio has an engine's model loaded. */
export interface LmStudioControl {
	/** How the model is loaded, or undefined when LM Studio can't be asked. */
	read(engine: EngineConfig): Promise<LoadedModel | undefined>;
	/** Loads the model with a context length, unloading its current instances first. */
	load(engine: EngineConfig, contextLength: number, current: LoadedModel): Promise<void>;
}

/** What to run. */
export interface RunInput {
	sourcePath: string;
	templateId: string;
	popup: PopupOverrides;
}

/** The three requests a run can send (design decision 4). */
export type RequestName = 'main' | 'inline' | 'tags' | 'model';

/** A request too large for the engine's context window (REQ-16). */
export interface OversizedRequest {
	request: 'main' | 'inline';
	estimate: number;
	limit: number;
}

/** What to do when the output name is taken and collisions are set to "ask" (10.0.4). */
export type CollisionChoice = { action: 'rename'; name: string } | { action: 'number' } | { action: 'cancel' };

/** How the UI follows and steers a run. */
export interface RunCallbacks {
	/** A request started, finished, failed or wasn't needed. */
	onStatus?: (request: RequestName, status: 'pending' | 'done' | 'failed' | 'skipped') => void;
	/** Main output text as it streams in (8.0.3). */
	onDelta?: (text: string) => void;
	/** Asked before sending when a request is too long; resolve false to send nothing (16.0.2). */
	confirmLongNote?: (oversized: OversizedRequest[]) => Promise<boolean>;
	/** Asked when the output name is taken and collisions are set to "ask". */
	resolveCollision?: (takenPath: string) => Promise<CollisionChoice>;
}

/** A finished run, waiting in the preview. */
export interface RunPreview {
	/** The exact text that will be saved (design decision 1). */
	text: string;
	/** Where the note will be created. */
	path: string;
	/** Everything the preview's warnings strip shows: truncation, dropped tags, unanswered prompts, notices. */
	warnings: string[];
	config: RunConfig;
	source: TFile;
	/** The source link written into `text`, so it can be updated if the path changes at save time. */
	link?: string;
}

/** How a run ended. */
export type RunOutcome =
	| { kind: 'preview'; preview: RunPreview }
	| { kind: 'saved'; preview: RunPreview; file: TFile }
	| { kind: 'cancelled' }
	/** The user chose not to send an over-long request (16.2). */
	| { kind: 'declined' }
	| { kind: 'failed'; error: Error; notices: string[] };

/** A request's outcome, kept separate so one failure doesn't stop the others. */
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
	try {
		return { ok: true, value: await promise };
	} catch (error) {
		return { ok: false, error };
	}
}

/** Thrown inside a run when it has been cancelled. */
class Cancelled extends Error {}

/** The plain-language list of dropped tags for the warnings strip (13.0.5). */
function droppedWarning(dropped: DroppedTag[]): string | undefined {
	if (dropped.length === 0) return undefined;
	const parts = dropped.map((d) => `${d.tag} (${d.reason === 'invalid' ? 'not a valid tag' : 'not in the vault'})`);
	return `Tags left out: ${parts.join(', ')}.`;
}

/** Runs templates and saves their output. One controller runs one thing at a time. */
export class RunController {
	private token = 0;
	private abort: AbortController | undefined;
	private cancelRun: (() => void) | undefined;

	constructor(private readonly host: RunHost) {}

	/**
	 * Cancels the current run. Streaming requests are aborted; `requestUrl`
	 * requests can't be, so their results are dropped when they arrive
	 * (design decision 5). Either way, nothing is written (8.0.4).
	 */
	cancel(): void {
		this.token++;
		this.abort?.abort();
		this.cancelRun?.();
	}

	/** Runs a template on a note, up to the preview (or the saved note, with "Skip preview"). */
	async start(input: RunInput, callbacks: RunCallbacks = {}): Promise<RunOutcome> {
		this.cancel();
		const token = ++this.token;
		const abort = new AbortController();
		this.abort = abort;
		const cancelled = new Promise<RunOutcome>((resolve) => {
			this.cancelRun = () => resolve({ kind: 'cancelled' });
		});
		const work = this.run(input, callbacks, token, abort.signal).catch((error: unknown): RunOutcome => {
			if (error instanceof Cancelled || (error instanceof NormalizedError && error.kind === 'cancelled')) return { kind: 'cancelled' };
			return { kind: 'failed', error: error instanceof Error ? error : new Error(String(error)), notices: [] };
		});
		const outcome = await Promise.race([work, cancelled]);
		return token === this.token ? outcome : { kind: 'cancelled' };
	}

	private check(token: number): void {
		if (token !== this.token) throw new Cancelled();
	}

	private async run(input: RunInput, callbacks: RunCallbacks, token: number, signal: AbortSignal): Promise<RunOutcome> {
		const { app, store } = this.host;
		const data = store.data;
		const template = data.templates.find((t) => t.id === input.templateId);
		if (!template) throw new Error('That template no longer exists. Pick another one.');
		const source = fileAt(app, input.sourcePath);
		if (!source) throw new Error(`The source note "${input.sourcePath}" no longer exists. Pick another one.`);

		const now = this.host.now?.() ?? new Date();
		const note = await readNote(app, source);
		this.check(token);
		const { config, notices: resolveNotices } = resolveRunConfig({
			popup: input.popup,
			template,
			globalSettings: data.globalSettings,
			engines: data.engines,
			defaultEngineId: data.defaultEngineId,
		});
		const engineConfig = config.engine;
		if (!engineConfig) throw new Error('No engine is configured. Add one in Inference Machine\'s settings.');
		const notices = new Set(resolveNotices);
		const addNotices = (list: string[]) => list.forEach((n) => notices.add(n));

		const requests = await this.buildRequests(template, config, note, now, addNotices);
		this.check(token);

		let contextWindow = engineConfig.contextWindow;
		const lmStudio = this.host.lmStudio;
		if (engineConfig.lmStudio && lmStudio) {
			const loaded = await lmStudio.read(engineConfig);
			this.check(token);
			let loadedLength = loaded?.contextLength;
			const wanted = engineConfig.contextWindow;
			// 4.0.10: load the model with the engine's context window when asked to.
			if (engineConfig.lmStudio.loadContext && wanted !== undefined && loaded && loaded.contextLength !== wanted) {
				callbacks.onStatus?.('model', 'pending');
				try {
					await lmStudio.load(engineConfig, wanted, loaded);
				} catch (error) {
					callbacks.onStatus?.('model', 'failed');
					return { kind: 'failed', error: error instanceof Error ? error : new Error(String(error)), notices: [...notices] };
				}
				this.check(token);
				callbacks.onStatus?.('model', 'done');
				loadedLength = wanted;
			}
			// 4.0.9: warn against what LM Studio will actually accept.
			if (loadedLength !== undefined) contextWindow = contextWindow === undefined ? loadedLength : Math.min(contextWindow, loadedLength);
		}

		// 16.0.1: size-check what will be sent, before sending anything.
		const oversized: OversizedRequest[] = [];
		for (const [name, request] of [['main', requests.main], ['inline', requests.inline?.request]] as const) {
			if (!request) continue;
			const fit = checkFits(`${request.system ?? ''}\n${request.user}`, contextWindow, engineConfig.maxOutputTokens);
			if (fit.status === 'over') oversized.push({ request: name, estimate: fit.estimate, limit: fit.limit });
		}
		if (oversized.length > 0 && callbacks.confirmLongNote && !(await callbacks.confirmLongNote(oversized))) return { kind: 'declined' };
		this.check(token);

		const engine = this.host.engineFor(engineConfig);
		const status = callbacks.onStatus ?? (() => undefined);
		const track = <T>(name: RequestName, promise: Promise<T> | undefined): Promise<Settled<T> | undefined> => {
			if (!promise) {
				status(name, 'skipped');
				return Promise.resolve(undefined);
			}
			status(name, 'pending');
			return settle(promise).then((result) => {
				if (token === this.token) status(name, result.ok ? 'done' : 'failed');
				return result;
			});
		};

		// Design decision 4: the three requests don't depend on each other, so they're sent together.
		const [main, inline, tags] = await Promise.all([
			track<ChatResult>('main', requests.main && engine.stream(requests.main, (t) => token === this.token && callbacks.onDelta?.(t), signal)),
			track<ChatResult>('inline', requests.inline && engine.complete(requests.inline.request, { json: true })),
			track('tags', requests.tagging && requestAiTags((r, o) => engine.complete(r, o), requests.tagging)),
		]);
		this.check(token);

		let mainOutput: string | undefined;
		const warnings: string[] = [];
		if (main) {
			if (!main.ok) {
				if (main.error instanceof NormalizedError && main.error.kind === 'cancelled') throw new Cancelled();
				// 8.0.6: a failed main request fails the run, keeping the popup's selections for a retry.
				return { kind: 'failed', error: main.error instanceof Error ? main.error : new Error(String(main.error)), notices: [...notices] };
			}
			// 8.0.8: a reasoning model's <think> working isn't part of the note.
			const answer = stripReasoning(main.value.text);
			if (answer.trim() === '') {
				// 8.0.9: an answer missing because the output limit ran out isn't "empty"; say why.
				const error = main.value.truncated
					? new NormalizedError('output-limit', outputLimitMessage(engineConfig.name, 'an answer'))
					: new NormalizedError('empty', `${engineConfig.name} returned an empty response.`);
				return { kind: 'failed', error, notices: [...notices] };
			}
			mainOutput = answer;
			if (main.value.notice) notices.add(main.value.notice);
			if (main.value.truncated) {
				warnings.push(`The output was cut off at ${engineConfig.name}'s output limit. Raise the engine's maximum output tokens to get the rest.`);
			}
		}

		let answers = new Map<string, string>();
		if (requests.inline && inline) {
			const raw = inline.ok ? parseInlineResponse(stripReasoning(inline.value.text), requests.inline.prompts.length) : [];
			if (inline.ok && inline.value.truncated && raw.every((answer) => answer === undefined)) {
				notices.add(outputLimitMessage(engineConfig.name, 'any inline prompt answers'));
			}
			const paired = answerMap(requests.inline.prompts, raw);
			answers = paired.answers;
			if (!inline.ok) notices.add(`The inline prompt request failed: ${inline.error instanceof Error ? inline.error.message : String(inline.error)}`);
			const unanswered = unansweredNotice(paired.unanswered);
			if (unanswered) notices.add(unanswered);
		}

		let aiTags: string[] = [];
		if (tags?.ok) {
			aiTags = tags.value.tags;
			if (tags.value.notice) notices.add(tags.value.notice);
		}

		const composed = await composeNote({
			config,
			note,
			now,
			mainOutput,
			answers,
			aiTags,
			vaultTags: requests.vaultTags,
			yaml: this.host.yaml,
		});
		addNotices(composed.notices);
		this.check(token);

		const path = await this.planOutputPath(config, note, composed, callbacks);
		this.check(token);
		if (path === undefined) return { kind: 'cancelled' };
		const link = config.references.enabled ? sourceLink(app, source, path) : undefined;
		const dropped = droppedWarning(composed.dropped);
		const preview: RunPreview = {
			text: composed.assemble({ link }),
			path,
			warnings: [...warnings, ...(dropped ? [dropped] : []), ...notices],
			config,
			source,
			...(link !== undefined ? { link } : {}),
		};

		await store.update((d) => {
			d.ui.lastTemplateId = template.id;
			if (input.popup.location) d.ui.lastLocation = input.popup.location;
		});
		if (config.skipPreview) {
			const file = await this.save(preview);
			return { kind: 'saved', preview, file };
		}
		return { kind: 'preview', preview };
	}

	/** Builds the main, inline and tagging requests, each only when the template needs it. */
	private async buildRequests(template: Template, config: RunConfig, note: NoteSnapshot, now: Date, addNotices: (n: string[]) => void) {
		const variables = buildVariables(note, { templateName: template.name, now });
		const renderPart = async (text: string) => {
			const result = await render(text, variables);
			addNotices(result.notices);
			return result.text;
		};

		let main: ChatRequest | undefined;
		// 21.0.5: no main prompt, no main request.
		if (template.prompt?.trim()) {
			main = { user: buildMainPrompt(template.prompt, await renderPart(template.prompt), note) };
		}

		let inline: { request: ChatRequest; prompts: string[] } | undefined;
		const prompts = collectTemplatePrompts({
			noteNameFormat: config.noteNameFormat,
			propertyValues: (template.properties ?? []).map((p) => p.value),
			noteContentFormat: config.noteContentFormat,
		});
		// 21.0.8: no inline prompts, no inline request; one request however many there are (21.0.2).
		if (prompts.length > 0) inline = { request: buildInlineRequest(await renderPart(config.context), prompts), prompts };

		let tagging: ChatRequest | undefined;
		let vaultTags: string[] = [];
		// 14.1: with AI tagging off, the vault's tags are never collected, let alone sent.
		if (config.tagging.aiTagging) {
			vaultTags = this.host.tagIndex.ranked(MAX_VAULT_TAGS);
			const prefixes = config.tagging.hierarchicalPrefixes ? this.host.tagIndex.prefixes() : [];
			tagging = buildTaggingRequest({ note, settings: config.tagging, vaultTags, prefixes });
		}
		return { main, inline, tagging, vaultTags };
	}

	/** Plans the output path, asking the user first when collisions are set to "ask" (10.0.4). */
	private async planOutputPath(config: RunConfig, note: NoteSnapshot, composed: ComposedNote, callbacks: RunCallbacks): Promise<string | undefined> {
		const folder = outputFolder(config.location, note);
		let name = composed.fileName;
		for (;;) {
			// The first free path, numbered if the name is taken.
			const path = await planPath(this.host.app, folder, name);
			const unnumbered = notePath(folder, sanitizeFilename(name));
			if (path === unnumbered || config.collision !== 'ask' || !callbacks.resolveCollision) return path;
			const choice = await callbacks.resolveCollision(unnumbered);
			if (choice.action === 'cancel') return undefined;
			if (choice.action === 'number') return path;
			name = choice.name;
		}
	}

	/**
	 * Saves the previewed (and possibly edited) note (9.0.2). If the planned
	 * name was taken while the preview was open, the next free number is used
	 * and the source link is updated to match. The note is then opened when
	 * the settings say so (10.0.7).
	 */
	async save(preview: RunPreview, text: string = preview.text): Promise<TFile> {
		const { app } = this.host;
		let path = preview.path;
		let finalText = text;
		if (fileAt(app, path) || (await app.vault.adapter.exists(path))) {
			const slash = path.lastIndexOf('/');
			path = await planPath(app, slash === -1 ? '' : path.slice(0, slash), path.slice(slash + 1, -3));
			if (preview.link !== undefined) {
				const link = sourceLink(app, preview.source, path);
				const at = finalText.lastIndexOf(preview.link);
				if (at !== -1) finalText = finalText.slice(0, at) + link + finalText.slice(at + preview.link.length);
			}
		}
		const file = await createNote(app, path, finalText);
		if (preview.config.openAfterCreate) await openNote(app, file);
		return file;
	}
}
