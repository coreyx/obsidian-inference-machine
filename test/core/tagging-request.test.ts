import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../src/core/defaults';
import type { ResolvedTagging } from '../../src/core/resolve';
import { buildTags } from '../../src/core/tags/pipeline';
import { buildTaggingRequest, MAX_VAULT_TAGS, parseTaggingResponse, requestAiTags } from '../../src/core/tagging-request';
import { FakeEngine } from '../fixtures/fake-engine';
import { snapshot } from '../fixtures/notes';

const note = snapshot('Notes/LLM.md', '---\ntags: [reading]\n---\nAgents and models. #draft', {}, { frontmatterTags: ['reading'], inlineTags: ['draft'] });
const settings: ResolvedTagging = { ...DEFAULTS.tagging, aiTagging: true, preferredTags: [] };

function prompt(overrides: Partial<ResolvedTagging> = {}, vaultTags: string[] = ['ai/llm', 'DevOps'], prefixes: string[] = ['ai/']) {
	return buildTaggingRequest({ note, settings: { ...settings, ...overrides }, vaultTags, prefixes }).user;
}

describe('buildTaggingRequest', () => {
	it('asks for the count range, the format and the note', () => {
		const text = prompt();
		expect(text).toContain('between 3 and 7 tags');
		expect(text).toContain('kebab-case');
		expect(text).toContain('Agents and models.');
		expect(text).toContain('"LLM"');
		expect(buildTaggingRequest({ note, settings, vaultTags: [], prefixes: [] }).system).toContain('{"tags":');
	});

	it('describes each named format, and passes a custom one verbatim (13.3)', () => {
		expect(prompt({ format: 'snake' })).toContain('snake_case');
		expect(prompt({ format: 'camel' })).toContain('camelCase');
		expect(prompt({ format: 'pascal' })).toContain('PascalCase');
		expect(prompt({ format: { custom: 'Title Case, with spaces turned into hyphens' } })).toContain(
			'Write each tag in this format: Title Case, with spaces turned into hyphens',
		);
	});

	it('sends ranked vault tags only when reuse is on, capped at 1,000 (14.0.3)', () => {
		expect(prompt()).toContain('Existing tags in this vault, most used first:\nai/llm\nDevOps');
		expect(prompt()).toMatch(/Reuse an existing tag/u);
		expect(prompt({ reuseVaultTags: false })).not.toContain('ai/llm\nDevOps');
		const many = Array.from({ length: 1500 }, (_, i) => `tag${i}`);
		const text = prompt({}, many);
		expect(text).toContain(`tag${MAX_VAULT_TAGS - 1}\n`);
		expect(text).not.toContain(`tag${MAX_VAULT_TAGS}\n`);
	});

	it('includes the vault\'s prefixes when hierarchical prefixes are on (14.4)', () => {
		expect(prompt()).toContain('The vault already uses these prefixes: ai/.');
		expect(prompt({}, [], [])).toContain('topic/subtopic');
		expect(prompt({ hierarchicalPrefixes: false })).toContain('Return flat tags only');
		expect(prompt({ hierarchicalPrefixes: false })).not.toContain('prefixes: ai/');
	});

	it('asks for existing tags only, and favors preferred tags', () => {
		expect(prompt({ existingOnly: true })).toContain('Use only tags from the list of existing tags');
		expect(prompt({ preferredTags: ['flashcards', 'study'] })).toContain('Favor these tags when they fit the note: flashcards, study.');
	});

	it('names the note\'s own tags so they aren\'t suggested again', () => {
		expect(prompt()).toContain('so don\'t suggest them again: reading, draft.');
		expect(prompt({ mergeSourceTags: false })).not.toContain('suggest them again');
	});
});

describe('parseTaggingResponse', () => {
	it('reads JSON objects, arrays and plain lists', () => {
		expect(parseTaggingResponse('{"tags": ["a", "#b", 3]}')).toEqual(['a', 'b']);
		expect(parseTaggingResponse('Here: ["x","y"]')).toEqual(['x', 'y']);
		expect(parseTaggingResponse('```json\n{"tags":"a, b"}\n```')).toEqual(['a', 'b']);
		expect(parseTaggingResponse('- machine-learning\n- #ai/agents\n1. devops')).toEqual(['machine-learning', 'ai/agents', 'devops']);
		expect(parseTaggingResponse('"one", "two"')).toEqual(['one', 'two']);
		expect(parseTaggingResponse('{"oops": true}')).toEqual([]);
		expect(parseTaggingResponse('[broken')).toEqual([]);
	});
});

describe('requestAiTags (with a fixture engine)', () => {
	it('sends one JSON request and returns the tags', async () => {
		const engine = new FakeEngine(() => '{"tags":["agents","models"]}');
		const result = await requestAiTags((r, o) => engine.complete(r, o), buildTaggingRequest({ note, settings, vaultTags: [], prefixes: [] }));
		expect(result).toEqual({ tags: ['agents', 'models'] });
		expect(engine.received).toHaveLength(1);
		expect(engine.received[0]).toMatchObject({ mode: 'complete', json: true });
	});

	it('caps a reply of 10 tags at the maximum (14.2)', async () => {
		const engine = new FakeEngine(() => JSON.stringify({ tags: ['reading', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'] }));
		const { tags: ai } = await requestAiTags((r, o) => engine.complete(r, o), { user: 'x' });
		const { tags } = buildTags({ sourceFrontmatter: ['reading'], sourceInline: [], template: [], ai, vaultTags: [], settings });
		const aiOnly = tags.filter((t) => t !== 'reading');
		expect(aiOnly.length).toBeGreaterThanOrEqual(settings.minTags);
		expect(aiOnly).toHaveLength(settings.maxTags);
	});

	it('drops an invented tag in existing-only mode (14.3)', async () => {
		const engine = new FakeEngine(() => '{"tags":["ai/llm","quantum-baking"]}');
		const { tags: ai } = await requestAiTags((r, o) => engine.complete(r, o), { user: 'x' });
		const result = buildTags({ sourceFrontmatter: [], sourceInline: [], template: [], ai, vaultTags: ['ai/llm'], settings: { ...settings, existingOnly: true } });
		expect(result.tags).toEqual(['ai/llm']);
	});

	it('flattens nested tags when prefixes are off (14.5)', async () => {
		const engine = new FakeEngine(() => '{"tags":["ai/agents"]}');
		const { tags: ai } = await requestAiTags((r, o) => engine.complete(r, o), { user: 'x' });
		expect(buildTags({ sourceFrontmatter: [], sourceInline: [], template: [], ai, vaultTags: [], settings: { ...settings, hierarchicalPrefixes: false } }).tags).toEqual([
			'ai-agents',
		]);
	});

	it('degrades to no AI tags with a notice when the request fails or says nothing usable (14.6)', async () => {
		const failing = new FakeEngine(() => new Error('Claude is limiting requests right now (HTTP 429).'));
		expect(await requestAiTags((r, o) => failing.complete(r, o), { user: 'x' })).toEqual({
			tags: [],
			notice: 'AI tagging failed, so the note has no AI tags. Claude is limiting requests right now (HTTP 429).',
		});
		const empty = new FakeEngine(() => '{"tags": []}');
		expect((await requestAiTags((r, o) => empty.complete(r, o), { user: 'x' })).notice).toMatch(/no usable tags/u);
		const thrower = async (): Promise<never> => {
			// eslint-disable-next-line @typescript-eslint/only-throw-error -- the code under test must cope with code that throws a non-Error value.
			throw 'plain string';
		};
		expect((await requestAiTags(thrower, { user: 'x' })).notice).toMatch(/plain string$/u);
	});
});
