import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import type { ChatRequest } from '../../src/core/chat';
import { defaultPluginData } from '../../src/core/defaults';
import type { EngineConfig, Template } from '../../src/core/schema';
import { exportTemplates, importTemplates, TEMPLATE_FILE_PLUGIN } from '../../src/core/template-transfer';
import { SettingsStore } from '../../src/obsidian/settings-store';
import { VaultTagIndex } from '../../src/obsidian/tag-index';
import { RunController } from '../../src/run/run-controller';
import { FakeApp } from '../fake-app';
import { FakeEngine } from '../fixtures/fake-engine';

let n = 0;
const newId = () => `new-${++n}`;
const claude: EngineConfig = { id: 'e-claude', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5-5', secretId: 'anthropic-secret-id' };
const full: Template = {
	id: 'orig',
	name: 'Meeting digest',
	prompt: 'Digest {{content}}',
	context: '{{body}}',
	noteNameFormat: '{{date}} {{title}}',
	location: { mode: 'folder', path: 'Digests' },
	noteContentFormat: '{{output}}',
	properties: [{ name: 'summary', value: '{{"one line"}}', type: 'text' }],
	omitEmptyProperties: true,
	tagging: { aiTagging: true, format: { custom: 'Title Case' }, preferredTags: ['meetings'] },
	engineId: 'e-claude',
	skipPreview: false,
	references: { enabled: true, heading: '## Sources' },
	openAfterCreate: false,
	origin: { builtInId: 'x', version: 1, hash: 'h' },
};

describe('exportTemplates and importTemplates', () => {
	it('round-trips a template into a fresh vault unchanged (20.1)', () => {
		const text = exportTemplates([full], [claude]);
		const freshEngines: EngineConfig[] = [{ ...claude, id: 'other-vault-id' }];
		const result = importTemplates(text, [], freshEngines, () => 'fresh-id');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { id: _id, origin: _origin, engineId: _engine, ...expected } = full;
		const { id, engineId, ...imported } = result.templates[0]!;
		expect(imported).toEqual(expected);
		expect(id).toBe('fresh-id');
		expect(engineId).toBe('other-vault-id');
	});

	it('never exports credentials, only the engine\'s name (20.2)', () => {
		const text = exportTemplates([full], [claude]);
		expect(text).not.toContain('anthropic-secret-id');
		expect(text).not.toContain('secretId');
		expect(text).not.toContain('e-claude');
		expect(JSON.parse(text)).toMatchObject({ schemaVersion: '1', plugin: TEMPLATE_FILE_PLUGIN, templates: [{ engineName: 'Claude' }] });
		expect(exportTemplates([{ ...full, engineId: 'gone' }], [claude])).not.toContain('engineName');
	});

	it('numbers an imported name that\'s taken (20.3)', () => {
		const text = exportTemplates([{ id: 'a', name: 'Summary', prompt: 'p' }, { id: 'b', name: 'Summary', prompt: 'q' }], []);
		const result = importTemplates(text, [{ id: 'x', name: 'Summary', prompt: 'p' }], [], newId);
		expect(result.ok && result.templates.map((t) => t.name)).toEqual(['Summary 1', 'Summary 2']);
	});

	it('imports a template whose engine doesn\'t exist, leaving the engine to the default (20.0.6)', () => {
		const result = importTemplates(exportTemplates([full], [claude]), [], [], newId);
		expect(result.ok && result.templates[0]!.engineId).toBeUndefined();
	});

	it('rejects a malformed file whole, with a reason (20.4)', () => {
		const good = JSON.parse(exportTemplates([{ id: 'a', name: 'Good', prompt: 'p' }], [])) as { templates: unknown[] };
		const cases: [string, RegExp][] = [
			['{not json', /isn't valid JSON/u],
			['{"plugin":"something-else","templates":[]}', /isn't an Inference Machine template file/u],
			[JSON.stringify({ schemaVersion: '9', plugin: TEMPLATE_FILE_PLUGIN, templates: good.templates }), /format version 9/u],
			[JSON.stringify({ schemaVersion: '1', plugin: TEMPLATE_FILE_PLUGIN, templates: [] }), /no templates/u],
			[JSON.stringify({ schemaVersion: '1', plugin: TEMPLATE_FILE_PLUGIN, templates: [...good.templates, { name: 'Bad', prompt: 42 }] }), /"prompt" must be text/u],
			[JSON.stringify({ schemaVersion: '1', plugin: TEMPLATE_FILE_PLUGIN, templates: [{ name: 'Empty' }] }), /no main prompt and no inline prompts/u],
			[JSON.stringify({ schemaVersion: '1', plugin: TEMPLATE_FILE_PLUGIN, templates: [{ prompt: 'p' }] }), /has no name/u],
		];
		for (const [text, error] of cases) {
			const result = importTemplates(text, [], [], newId);
			expect(result.ok, text).toBe(false);
			if (!result.ok) expect(result.error).toMatch(error);
		}
	});
});

/** The example template files users import (20.0.7). */
function example(name: string): Template {
	const result = importTemplates(readFileSync(`examples/${name}.json`, 'utf8'), [], [], () => name);
	if (!result.ok) throw new Error(result.error);
	return result.templates[0]!;
}

/** Runs a template through the real run controller, with a fixture engine answering its inline prompts by keyword. */
async function runExample(template: Template, path: string, note: string, answers: (prompt: string) => string) {
	const fake = new FakeApp({ [path]: note });
	const data = defaultPluginData();
	data.engines = [{ id: 'e', name: 'Fixture', provider: 'openai-compatible', model: 'm', baseUrl: 'http://localhost:1/v1' }];
	data.defaultEngineId = 'e';
	data.templates = [template];
	const store = new SettingsStore({ loadData: async () => data, saveData: async () => undefined });
	await store.load();
	const engine = new FakeEngine((request: ChatRequest) => {
		const marker = 'Prompts to answer:\n';
		const prompts = (JSON.parse(request.user.slice(request.user.lastIndexOf(marker) + marker.length)) as { prompts: Record<string, string> }).prompts;
		return JSON.stringify({ prompts_responses: Object.fromEntries(Object.entries(prompts).map(([key, prompt]) => [key, answers(prompt)])) });
	});
	const controller = new RunController({
		app: fake.app,
		store,
		engineFor: () => engine,
		tagIndex: new VaultTagIndex(fake.app),
		yaml: { parse: (t) => YAML.parse(t) as unknown, stringify: (v) => YAML.stringify(v) },
		now: () => new Date(2026, 9, 17),
	});
	const outcome = await controller.start({ sourcePath: path, templateId: template.id, popup: {} });
	if (outcome.kind !== 'preview') throw new Error(`Run ended with ${outcome.kind}`);
	const text = outcome.preview.text;
	return { engine, preview: outcome.preview, frontmatter: YAML.parse(text.split('---\n')[1]!) as Record<string, unknown>, body: text.split('---\n').slice(2).join('---\n') };
}

describe('the example templates (20.5)', () => {
	it('are all valid template files with inline prompts only, leaving out empty properties (20.0.8)', () => {
		for (const name of ['recipe-card', 'book-reference', 'movie-reference']) {
			const template = example(name);
			expect(template.prompt).toBeUndefined();
			expect(template.omitEmptyProperties).toBe(true);
			const text = JSON.stringify(template);
			expect(text).toMatch(/leave empty/iu);
			const lines = template.noteContentFormat!.split('\n');
			lines.forEach((line, i) => {
				if (line.startsWith('#')) expect(lines[i + 1], `${name}: ${line}`).toBe('');
			});
		}
	});

	it('turn a rough recipe into a recipe card', async () => {
		const note = 'pancakes - 2 eggs, 1 cup flour, milk. mix, rest 10 min, fry. serves 4';
		const { frontmatter, body, engine } = await runExample(example('recipe-card'), 'Kitchen/pancakes.md', note, (prompt) => {
			if (prompt.startsWith('the name of the dish')) return 'Pancakes';
			if (prompt.startsWith('how many servings')) return '4';
			if (prompt.startsWith('every ingredient')) return '- [ ] 2 eggs\n- [ ] 1 cup flour\n- [ ] Milk';
			if (prompt.startsWith('the steps')) return '1. Mix.\n2. Rest for 10 minutes.\n3. Fry.';
			return '';
		});
		expect(engine.received).toHaveLength(1);
		expect(frontmatter).toEqual({ servings: 4, categories: ['[[Recipes]]'], created: '2026-10-17', tags: ['recipes'] });
		expect(body).toContain('## Ingredients\n\n- [ ] 2 eggs');
		expect(body).toContain('1. Mix.');
	});

	it('turn a note about a book into a book reference, without a year it doesn\'t state (20.6)', async () => {
		const note = 'Finished Dune by Frank Herbert. Loved the ecology angle.';
		const { frontmatter, preview } = await runExample(example('book-reference'), 'Reading/finished-dune.md', note, (prompt) => {
			if (prompt.startsWith('the title of the book')) return 'Dune';
			if (prompt.startsWith('the book\'s author')) return 'Frank Herbert';
			if (prompt.startsWith('two or three sentences')) return 'A note on finishing Dune.';
			return '';
		});
		expect(preview.path).toBe('Reading/Dune.md');
		expect(frontmatter).toEqual({ title: 'Dune', author: ['[[Frank Herbert]]'], categories: ['[[Books]]'], created: '2026-10-17', tags: ['books'] });
		expect(frontmatter).not.toHaveProperty('year');
	});

	it('turn a note about a film into a movie reference', async () => {
		const note = 'Watched Arrival (2016), Villeneuve. Amy Adams was great.';
		const { frontmatter } = await runExample(example('movie-reference'), 'Films/arrival.md', note, (prompt) => {
			if (prompt.startsWith('the title of the film')) return 'Arrival';
			if (prompt.startsWith('the film\'s director')) return 'Denis Villeneuve';
			if (prompt.startsWith('the actors')) return 'Amy Adams';
			if (prompt.startsWith('the year the film')) return '2016';
			return '';
		});
		expect(frontmatter).toEqual({
			title: 'Arrival',
			director: ['[[Denis Villeneuve]]'],
			cast: ['[[Amy Adams]]'],
			year: 2016,
			categories: ['[[Movies]]'],
			created: '2026-10-17',
			tags: ['movies'],
		});
	});
});
