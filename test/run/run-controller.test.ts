import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import type { ChatRequest } from '../../src/core/chat';
import { defaultPluginData } from '../../src/core/defaults';
import type { EngineConfig, PluginData, Template } from '../../src/core/schema';
import { NormalizedError } from '../../src/engines/engine';
import { SettingsStore } from '../../src/obsidian/settings-store';
import { VaultTagIndex } from '../../src/obsidian/tag-index';
import type { LoadedModel } from '../../src/engines/lmstudio';
import { RunController, type LmStudioControl, type RunCallbacks, type RunOutcome } from '../../src/run/run-controller';
import { FakeApp } from '../fake-app';
import { FakeEngine, type Responder } from '../fixtures/fake-engine';

const yaml = { parse: (t: string): unknown => YAML.parse(t), stringify: (v: unknown) => YAML.stringify(v) };
const now = new Date(2026, 9, 17, 9, 0, 0);
const ALPHA = '---\ntags: [Project]\nauthor: Ada\n---\n# Alpha\n\nWe ship the beta next week. #launch\n';
const engineConfig: EngineConfig = { id: 'e1', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5-5', secretId: 'k' };
const summary: Template = { id: 'summary', name: 'Summary', prompt: 'Summarize this.' };

type Kind = 'main' | 'inline' | 'tags';
/** Which of the three requests a fake engine call is. */
function kindOf(request: ChatRequest, mode: 'stream' | 'complete'): Kind {
	if (mode === 'stream') return 'main';
	return request.system?.includes('prompts_responses') ? 'inline' : 'tags';
}

/** Replies per request kind. */
function replies(map: Partial<Record<Kind, string | Error | (() => Promise<string | Error>)>>): Responder {
	return (request, mode) => {
		const reply = map[kindOf(request, mode)] ?? 'Default reply';
		return typeof reply === 'function' ? reply() : reply;
	};
}

interface Setup {
	templates?: Template[];
	engines?: EngineConfig[];
	responder?: Responder;
	data?: (d: PluginData) => void;
	notes?: Record<string, string>;
	lmStudio?: LmStudioControl;
}

async function setup(options: Setup = {}) {
	const fake = new FakeApp(options.notes ?? { 'Projects/Alpha.md': ALPHA });
	const data = defaultPluginData();
	data.engines = options.engines ?? [engineConfig];
	data.defaultEngineId = data.engines[0]?.id;
	data.templates = options.templates ?? [summary];
	options.data?.(data);
	const saved: unknown[] = [];
	const store = new SettingsStore({ loadData: async () => structuredClone(data), saveData: async (d) => void saved.push(d) });
	await store.load();
	const engine = new FakeEngine(options.responder ?? replies({ main: '## Summary\nShipping next week.' }));
	const tagIndex = new VaultTagIndex(fake.app);
	const controller = new RunController({ app: fake.app, store, engineFor: () => engine, tagIndex, yaml, now: () => now, lmStudio: options.lmStudio });
	const run = (templateId = 'summary', callbacks: RunCallbacks = {}, popup = {}) =>
		controller.start({ sourcePath: 'Projects/Alpha.md', templateId, popup }, callbacks);
	return { fake, store, engine, controller, run, tagIndex, saved };
}

function preview(outcome: RunOutcome) {
	if (outcome.kind !== 'preview' && outcome.kind !== 'saved') throw new Error(`Expected a preview, got ${outcome.kind}`);
	return outcome.preview;
}

function sourceUnchanged(fake: FakeApp) {
	const entry = fake.files.get('Projects/Alpha.md')!;
	expect(entry.content).toBe(ALPHA);
	expect(entry.file.stat.mtime).toBe(Date.UTC(2026, 9, 1));
	expect(fake.writes.filter((w) => w.path === 'Projects/Alpha.md')).toEqual([]);
}

/** A promise the test resolves by hand, to hold a request open. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

describe('a run with defaults', () => {
	it('goes from Run to preview with nothing written yet (8.1, 9.1)', async () => {
		const { run, fake, engine } = await setup();
		const result = preview(await run());
		expect(result.path).toBe('Projects/Alpha - Summary.md');
		expect(result.text).toBe('---\ntags:\n  - Project\n  - launch\n---\n## Summary\nShipping next week.\n\n# References\n- [[Alpha]]\n');
		expect(result.warnings).toEqual([]);
		expect(fake.writes).toEqual([]);
		expect(engine.received.map((r) => r.mode)).toEqual(['stream']);
		// 5.4: the note's filename and contents are appended to a prompt that doesn't place them.
		expect(engine.received[0]?.request.user).toBe(`Summarize this.\n\nFilename: Alpha.md\n\n${ALPHA}`);
		sourceUnchanged(fake);
	});

	it('saves the edited preview text and opens the note (9.2, 10.0.7)', async () => {
		const { run, controller, fake } = await setup();
		const result = preview(await run());
		const file = await controller.save(result, `${result.text}Edited by hand.\n`);
		expect(file.path).toBe('Projects/Alpha - Summary.md');
		expect(fake.files.get(file.path)?.content.endsWith('Edited by hand.\n')).toBe(true);
		expect(fake.opened).toEqual(['Projects/Alpha - Summary.md']);
		sourceUnchanged(fake);
	});

	it('numbers a second run\'s note instead of overwriting (10.4)', async () => {
		const { run, controller, fake } = await setup();
		await controller.save(preview(await run()));
		const second = preview(await run());
		expect(second.path).toBe('Projects/Alpha - Summary 1.md');
		await controller.save(second);
		expect([...fake.files.keys()].filter((p) => p.includes('Summary'))).toEqual(['Projects/Alpha - Summary.md', 'Projects/Alpha - Summary 1.md']);
	});

	it('streams text to the live view (8.5)', async () => {
		const { run } = await setup({ responder: replies({ main: 'x'.repeat(50) }) });
		const deltas: string[] = [];
		await run('summary', { onDelta: (t) => deltas.push(t) });
		expect(deltas.length).toBeGreaterThan(1);
		expect(deltas.join('')).toBe('x'.repeat(50));
	});

	it('remembers the template used last (19.3)', async () => {
		const { run, store } = await setup();
		await run('summary', {}, { location: { mode: 'folder', path: 'Out' } });
		expect(store.data.ui).toEqual({ lastTemplateId: 'summary', lastLocation: { mode: 'folder', path: 'Out' } });
	});
});

describe('output settings', () => {
	it('creates the folder when output goes to one (10.1)', async () => {
		const { run, controller, fake } = await setup();
		const result = preview(await run('summary', {}, { location: { mode: 'folder', path: 'Summaries/2026' } }));
		expect(result.path).toBe('Summaries/2026/Alpha - Summary.md');
		await controller.save(result);
		expect(fake.writes.map((w) => w.path)).toEqual(['Summaries', 'Summaries/2026', 'Summaries/2026/Alpha - Summary.md']);
	});

	it('saves without a preview when the template says so (9.4)', async () => {
		const { run, fake } = await setup({ templates: [{ ...summary, skipPreview: true }] });
		const outcome = await run();
		expect(outcome.kind).toBe('saved');
		expect(fake.files.has('Projects/Alpha - Summary.md')).toBe(true);
	});

	it('doesn\'t open the note when "Open the new note" is off (10.8)', async () => {
		const { run, controller, fake } = await setup({ templates: [{ ...summary, openAfterCreate: false }] });
		await controller.save(preview(await run()));
		expect(fake.opened).toEqual([]);
	});

	it('leaves the link out when references are off', async () => {
		const { run } = await setup({ templates: [{ ...summary, references: { enabled: false } }] });
		const result = preview(await run());
		expect(result.text).not.toContain('# References');
		expect(result.link).toBeUndefined();
	});

	it('uses the next free name and updates the link when the name is taken during the preview', async () => {
		const { run, controller, fake } = await setup();
		const result = preview(await run());
		fake.addNote('Projects/Alpha - Summary.md', 'someone else');
		const file = await controller.save(result);
		expect(file.path).toBe('Projects/Alpha - Summary 1.md');
		expect(fake.files.get('Projects/Alpha - Summary.md')?.content).toBe('someone else');
	});

	it('asks on a collision when set to, and follows the answer (10.0.4)', async () => {
		const { run, fake } = await setup({ data: (d) => (d.globalSettings.collision = 'ask') });
		fake.addNote('Projects/Alpha - Summary.md', 'x');
		const asked: string[] = [];
		const rename = preview(
			await run('summary', {
				resolveCollision: async (path) => {
					asked.push(path);
					return asked.length === 1 ? { action: 'rename', name: 'Alpha - Summary' } : { action: 'rename', name: 'Alpha recap' };
				},
			}),
		);
		expect(asked).toEqual(['Projects/Alpha - Summary.md', 'Projects/Alpha - Summary.md']);
		expect(rename.path).toBe('Projects/Alpha recap.md');
		expect(preview(await run('summary', { resolveCollision: async () => ({ action: 'number' }) })).path).toBe('Projects/Alpha - Summary 1.md');
		expect((await run('summary', { resolveCollision: async () => ({ action: 'cancel' }) })).kind).toBe('cancelled');
	});
});

describe('failures', () => {
	it('fails readably on an auth error, then works on retry (8.4)', async () => {
		let fail = true;
		const { run, fake } = await setup({
			responder: replies({ main: async () => (fail ? new NormalizedError('auth', 'Claude didn\'t accept the credentials (HTTP 401).') : 'Fixed') }),
		});
		const outcome = await run();
		expect(outcome).toMatchObject({ kind: 'failed', error: { kind: 'auth' } });
		fail = false;
		expect(preview(await run()).text).toContain('Fixed');
		sourceUnchanged(fake);
		expect(fake.writes).toEqual([]);
	});

	it('fails on an empty response (8.0.6)', async () => {
		const { run } = await setup({ responder: replies({ main: '   ' }) });
		expect(await run()).toMatchObject({ kind: 'failed', error: { kind: 'empty', message: 'Claude returned an empty response.' } });
	});

	it('reports a missing template, source note or engine', async () => {
		const { run, controller } = await setup();
		expect(await run('nope')).toMatchObject({ kind: 'failed', error: { message: expect.stringMatching(/template no longer exists/u) } });
		expect(await controller.start({ sourcePath: 'Gone.md', templateId: 'summary', popup: {} })).toMatchObject({ kind: 'failed' });
		const noEngine = await setup({ engines: [] });
		expect(await noEngine.run()).toMatchObject({ kind: 'failed', error: { message: expect.stringMatching(/No engine/u) } });
	});

	it('falls back to the default engine with a notice (3.5)', async () => {
		const { run } = await setup({ templates: [{ ...summary, engineId: 'deleted' }] });
		expect(preview(await run()).warnings).toContain('The engine set for template "Summary" no longer exists, so the default engine is used instead.');
	});

	it('warns about cut-off output and passes on the engine\'s streaming notice', async () => {
		const { run, engine } = await setup();
		engine.stream = async () => ({ text: 'Partial', truncated: true, streamed: false, notice: 'Streaming is blocked.' });
		const { warnings } = preview(await run());
		expect(warnings[0]).toMatch(/cut off at Claude's output limit/u);
		expect(warnings).toContain('Streaming is blocked.');
	});
});

describe('reasoning models (8.0.8, 8.0.9)', () => {
	it('keeps reasoning out of the note, streamed or not (8.8)', async () => {
		const { run } = await setup({ responder: replies({ main: '<think>Let me plan this.\nFirst the summary.</think>\n## Summary\nShipping next week.' }) });
		const text = preview(await run()).text;
		expect(text).toContain('## Summary\nShipping next week.');
		expect(text).not.toMatch(/think|plan this/iu);
	});

	it('explains an output limit spent reasoning instead of reporting an empty response (8.9)', async () => {
		const { run, engine } = await setup();
		engine.stream = async () => ({ text: '<think>still working this out', truncated: true, streamed: true });
		const outcome = await run();
		expect(outcome).toMatchObject({ kind: 'failed', error: { kind: 'output-limit' } });
		if (outcome.kind === 'failed') expect(outcome.error.message).toMatch(/^Claude used its whole output limit before writing an answer/u);
	});

	it('says the same when the inline prompt request runs out (8.9)', async () => {
		const template: Template = { id: 'inline', name: 'Inline', properties: [{ name: 'description', value: '{{"a description"}}', type: 'text' }] };
		const { run, engine } = await setup({ templates: [template] });
		engine.complete = async () => ({ text: '<think>what to say', truncated: true, streamed: false });
		const { warnings } = preview(await run('inline'));
		expect(warnings.some((w) => w.startsWith('Claude used its whole output limit before writing any inline prompt answers'))).toBe(true);
	});

	it('reads inline answers that follow reasoning', async () => {
		const template: Template = { id: 'inline', name: 'Inline', properties: [{ name: 'description', value: '{{"a description"}}', type: 'text' }] };
		const { run } = await setup({ templates: [template], responder: replies({ inline: '<think>ok</think>{"prompts_responses":{"prompt_1":"A short one."}}' }) });
		expect(preview(await run('inline')).text).toContain('description: A short one.');
	});
});

describe('cancelling (8.2, 2.4)', () => {
	it('cancels mid-stream and writes nothing', async () => {
		const hold = deferred<string>();
		const { run, controller, fake } = await setup({ responder: replies({ main: () => hold.promise }) });
		const pending = run();
		await Promise.resolve();
		controller.cancel();
		expect(await pending).toEqual({ kind: 'cancelled' });
		hold.resolve('Late result');
		await new Promise((r) => setTimeout(r, 0));
		expect(fake.writes).toEqual([]);
		sourceUnchanged(fake);
	});

	it('drops a non-streaming result that arrives after cancel', async () => {
		const hold = deferred<string>();
		const template: Template = { id: 'inline', name: 'Inline', properties: [{ name: 'description', value: '{{"a description"}}', type: 'text' }] };
		const { run, controller, fake } = await setup({ templates: [template], responder: replies({ inline: () => hold.promise }) });
		const pending = run('inline');
		await new Promise((r) => setTimeout(r, 0));
		controller.cancel();
		hold.resolve('{"prompts_responses":{"prompt_1":"late"}}');
		expect(await pending).toEqual({ kind: 'cancelled' });
		expect(fake.writes).toEqual([]);
	});

	it('cancels while the long-note warning is open', async () => {
		const { run, controller, engine } = await setup({ engines: [{ ...engineConfig, contextWindow: 10 }] });
		const outcome = run('summary', {
			confirmLongNote: async () => {
				controller.cancel();
				return true;
			},
		});
		expect(await outcome).toEqual({ kind: 'cancelled' });
		expect(engine.received).toEqual([]);
	});

	it('treats an engine\'s own cancelled error as a cancel', async () => {
		const { run } = await setup({ responder: replies({ main: new NormalizedError('cancelled', 'The run was cancelled.') }) });
		expect(await run()).toEqual({ kind: 'cancelled' });
	});

	it('cancels a run that is superseded by a new one', async () => {
		const hold = deferred<string>();
		let first = true;
		const { controller, engine } = await setup({
			responder: replies({
				main: () => {
					if (!first) return Promise.resolve('Second');
					first = false;
					return hold.promise;
				},
			}),
		});
		const one = controller.start({ sourcePath: 'Projects/Alpha.md', templateId: 'summary', popup: {} });
		while (engine.received.length === 0) await new Promise((r) => setTimeout(r, 0));
		const two = controller.start({ sourcePath: 'Projects/Alpha.md', templateId: 'summary', popup: {} });
		expect(await one).toEqual({ kind: 'cancelled' });
		expect(preview(await two).text).toContain('Second');
	});
});

describe('long notes (REQ-16)', () => {
	it('asks before sending a request over the context window (16.1), and sends nothing on Cancel (16.2)', async () => {
		const { run, engine } = await setup({ engines: [{ ...engineConfig, contextWindow: 30, maxOutputTokens: 10 }] });
		const asked: unknown[] = [];
		const outcome = await run('summary', {
			confirmLongNote: async (oversized) => {
				asked.push(...oversized);
				return false;
			},
		});
		expect(outcome).toEqual({ kind: 'declined' });
		expect(asked).toEqual([{ request: 'main', estimate: expect.any(Number), limit: 20 }]);
		expect(engine.received).toEqual([]);
	});

	it('sends the full note on Continue (16.2)', async () => {
		const { run, engine } = await setup({ engines: [{ ...engineConfig, contextWindow: 20 }] });
		let asked = false;
		await run('summary', { confirmLongNote: async () => (asked = true) });
		expect(asked).toBe(true);
		expect(engine.received[0]?.request.user).toContain(ALPHA);
	});

	it('doesn\'t ask when the context window is unknown (16.0.4)', async () => {
		const { run } = await setup();
		let asked = false;
		await run('summary', { confirmLongNote: async () => (asked = true) });
		expect(asked).toBe(false);
	});
});

describe('LM Studio context length (4.0.9, 4.0.10)', () => {
	const lmEngine: EngineConfig = { id: 'lm', name: 'LM Studio', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'qwen', contextWindow: 1000, lmStudio: { port: 1234 } };
	const reloading = (changes: Partial<EngineConfig> = {}): EngineConfig => ({ ...lmEngine, ...changes, lmStudio: { port: 1234, loadContext: true } });

	/** A scripted LM Studio that records loads. */
	function lmStudio(state: LoadedModel | undefined, load: (contextLength: number) => Promise<void> = async () => undefined) {
		const loads: { contextLength: number; current: LoadedModel }[] = [];
		const control: LmStudioControl = {
			read: async () => (state ? structuredClone(state) : undefined),
			load: async (_engine, contextLength, current) => {
				loads.push({ contextLength, current });
				await load(contextLength);
			},
		};
		return { control, loads };
	}

	/** Runs and returns what the long-note warning was asked about. */
	async function askedAbout(run: (templateId?: string, callbacks?: RunCallbacks) => Promise<RunOutcome>): Promise<unknown[]> {
		const asked: unknown[] = [];
		await run('summary', {
			confirmLongNote: async (oversized) => {
				asked.push(...oversized);
				return true;
			},
		});
		return asked;
	}

	it('warns against the length LM Studio has loaded when it is smaller than the setting (4.7)', async () => {
		const lm = lmStudio({ loaded: true, contextLength: 20, instanceIds: ['qwen'] });
		const { run } = await setup({ engines: [lmEngine], lmStudio: lm.control });
		expect(await askedAbout(run)).toEqual([{ request: 'main', estimate: expect.any(Number), limit: 20 }]);
		expect(lm.loads).toEqual([]);
	});

	it('uses the loaded length when the engine has no context window set', async () => {
		const noWindow: EngineConfig = { ...lmEngine };
		delete noWindow.contextWindow;
		const { run } = await setup({ engines: [noWindow], lmStudio: lmStudio({ loaded: true, contextLength: 20, instanceIds: ['qwen'] }).control });
		expect(await askedAbout(run)).toHaveLength(1);
	});

	it('keeps the setting when LM Studio has the model loaded with more, or can not be asked', async () => {
		for (const state of [{ loaded: true, contextLength: 5000, instanceIds: ['qwen'] }, undefined]) {
			const { run } = await setup({ engines: [{ ...lmEngine, contextWindow: 20 }], lmStudio: lmStudio(state).control });
			expect(await askedAbout(run)).toEqual([{ request: 'main', estimate: expect.any(Number), limit: 20 }]);
		}
	});

	it('reloads the model at the context window first, and says so (4.8)', async () => {
		const current = { loaded: true, contextLength: 8192, instanceIds: ['qwen'] };
		const lm = lmStudio(current);
		const { run, engine } = await setup({ engines: [reloading({ contextWindow: 65536 })], lmStudio: lm.control });
		const statuses: string[] = [];
		const outcome = await run('summary', { onStatus: (name, status) => statuses.push(`${name}:${status}`) });
		expect(outcome.kind).toBe('preview');
		expect(lm.loads).toEqual([{ contextLength: 65536, current }]);
		expect(statuses.slice(0, 2)).toEqual(['model:pending', 'model:done']);
		expect(engine.received).toHaveLength(1);
	});

	it('loads a model that is not loaded, then warns against the new length', async () => {
		const lm = lmStudio({ loaded: false, instanceIds: [] });
		const { run } = await setup({ engines: [reloading({ contextWindow: 20 })], lmStudio: lm.control });
		expect(await askedAbout(run)).toEqual([{ request: 'main', estimate: expect.any(Number), limit: 20 }]);
		expect(lm.loads.map((l) => l.contextLength)).toEqual([20]);
	});

	it('does not reload a model already at the right length, or when LM Studio decides', async () => {
		const atLength = lmStudio({ loaded: true, contextLength: 1000, instanceIds: ['qwen'] });
		await (await setup({ engines: [reloading()], lmStudio: atLength.control })).run();
		expect(atLength.loads).toEqual([]);
		const deciding = lmStudio({ loaded: true, contextLength: 8192, instanceIds: ['qwen'] });
		await (await setup({ engines: [lmEngine], lmStudio: deciding.control })).run();
		expect(deciding.loads).toEqual([]);
	});

	it('fails the run with the message from LM Studio when the load fails, sending nothing', async () => {
		const message = 'LM Studio could not load qwen (HTTP 500): Not enough memory.';
		const lm = lmStudio({ loaded: true, contextLength: 8192, instanceIds: ['qwen'] }, async () => {
			throw new Error(message);
		});
		const { run, engine } = await setup({ engines: [reloading()], lmStudio: lm.control });
		const statuses: string[] = [];
		const outcome = await run('summary', { onStatus: (name, status) => statuses.push(`${name}:${status}`) });
		expect(outcome).toMatchObject({ kind: 'failed', error: { message } });
		expect(statuses).toEqual(['model:pending', 'model:failed']);
		expect(engine.received).toEqual([]);
	});

	it('cancels while the model is loading', async () => {
		const hold = deferred<void>();
		const lm = lmStudio({ loaded: true, contextLength: 8192, instanceIds: ['qwen'] }, () => hold.promise);
		const { run, controller, engine } = await setup({ engines: [reloading()], lmStudio: lm.control });
		const outcome = run();
		while (lm.loads.length === 0) await new Promise((r) => setTimeout(r, 0));
		controller.cancel();
		hold.resolve();
		expect(await outcome).toEqual({ kind: 'cancelled' });
		expect(engine.received).toEqual([]);
	});

	it('leaves engines that LM Studio detection did not make alone', async () => {
		let read = false;
		const control: LmStudioControl = {
			read: async () => {
				read = true;
				return undefined;
			},
			load: async () => undefined,
		};
		await (await setup({ lmStudio: control })).run();
		expect(read).toBe(false);
	});
});

describe('inline prompts and AI tagging', () => {
	const threePrompts: Template = {
		id: 'three',
		name: 'Three',
		noteNameFormat: '{{"a short title"}}',
		properties: [
			{ name: 'description', value: '{{"a one-sentence description"}}', type: 'text' },
			{ name: 'phrases', value: '{{"three key phrases"|lower}}', type: 'text' },
		],
		noteContentFormat: 'Body: {{"a one-sentence description"}}',
	};

	it('answers any number of prompts in one request, with no main request (21.2, 21.4)', async () => {
		const answer = JSON.stringify({ prompts_responses: { prompt_1: 'Beta launch', prompt_2: 'The beta ships soon.', prompt_3: 'Beta, LAUNCH, Week' } });
		const statuses: string[] = [];
		const { run, engine } = await setup({ templates: [threePrompts], responder: replies({ inline: answer }) });
		const result = preview(await run('three', { onStatus: (name, status) => statuses.push(`${name}:${status}`) }));
		expect(engine.received.map((r) => [r.mode, r.json])).toEqual([['complete', true]]);
		expect(statuses).toEqual(['main:skipped', 'inline:pending', 'tags:skipped', 'inline:done']);
		expect(result.path).toBe('Projects/Beta launch.md');
		expect(result.text).toContain('description: The beta ships soon.');
		expect(result.text).toContain('phrases: beta, launch, week');
		expect(result.text).toContain('Body: The beta ships soon.');
	});

	it('sends no inline request for a template without inline prompts (21.8)', async () => {
		const { run, engine } = await setup();
		await run();
		expect(engine.received.filter((r) => r.mode === 'complete')).toEqual([]);
	});

	it('empties an unanswered prompt, names it, and keeps the others (21.6)', async () => {
		const { run } = await setup({ templates: [threePrompts], responder: replies({ inline: '{"prompts_responses":{"prompt_1":"Title","prompt_3":"a, b"}}' }) });
		const result = preview(await run('three'));
		// The template doesn't omit empty properties, so the property is written blank.
		expect(result.text).toContain('description: null');
		expect(result.warnings).toContain('No answer came back for the inline prompt "a one-sentence description", so it was left empty.');
		expect(result.path).toBe('Projects/Title.md');
	});

	it('still produces the note when the inline request fails', async () => {
		const { run } = await setup({ templates: [threePrompts], responder: replies({ inline: new Error('boom') }) });
		const result = preview(await run('three'));
		expect(result.warnings).toContain('The inline prompt request failed: boom');
		expect(result.path).toBe('Projects/Untitled.md');
	});

	it('sends no tagging request and builds no tag list with AI tagging off (14.1)', async () => {
		const { run, engine, tagIndex } = await setup();
		await run();
		expect(engine.received.some((r) => r.request.system?.includes('"tags"'))).toBe(false);
		expect(tagIndex.built).toBe(false);
	});

	it('adds AI tags, reusing vault spelling, alongside the main request', async () => {
		const notes = { 'Projects/Alpha.md': ALPHA, 'Other.md': '#DevOps #ai/llm' };
		const { run, engine, tagIndex } = await setup({
			notes,
			data: (d) => (d.globalSettings.tagging.aiTagging = true),
			responder: replies({ main: 'Body', tags: '{"tags":["dev-ops","ai/agents","1984"]}' }),
		});
		const result = preview(await run());
		expect(tagIndex.built).toBe(true);
		expect(engine.received.map((r) => r.mode).sort()).toEqual(['complete', 'stream']);
		const tagsRequest = engine.received.find((r) => r.mode === 'complete')!.request.user;
		expect(tagsRequest).toContain('ai/');
		expect(YAML.parse(result.text.split('---')[1]!)).toEqual({ tags: ['Project', 'launch', 'DevOps', 'ai/agents'] });
		expect(result.warnings).toContain('Tags left out: 1984 (not a valid tag).');
	});

	it('produces the note without AI tags when tagging fails (14.6)', async () => {
		const { run } = await setup({
			data: (d) => (d.globalSettings.tagging.aiTagging = true),
			responder: replies({ main: 'Body', tags: new Error('quota exceeded') }),
		});
		const result = preview(await run());
		expect(result.text).toContain('Body');
		expect(result.warnings).toContain('AI tagging failed, so the note has no AI tags. quota exceeded');
	});
});
