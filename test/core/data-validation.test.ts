import { describe, expect, it } from 'vitest';
import {
	checkEngine,
	checkLocation,
	checkTagFormat,
	checkTaggingOverrides,
	checkTemplate,
	fillGlobal,
	fillUiState,
} from '../../src/core/data-validation';
import { DEFAULTS } from '../../src/core/defaults';

describe('checkLocation', () => {
	it('accepts both modes and treats absence as inherit', () => {
		expect(checkLocation({ mode: 'alongside' }, 'x').value).toEqual({ mode: 'alongside' });
		expect(checkLocation({ mode: 'folder', path: 'A/B' }, 'x').value).toEqual({ mode: 'folder', path: 'A/B' });
		expect(checkLocation(undefined, 'x')).toEqual({ value: undefined, problems: [] });
	});

	it('reports a malformed location', () => {
		expect(checkLocation({ mode: 'folder' }, 'T').problems).toEqual(['T: output location isn\'t valid']);
	});
});

describe('checkTagFormat', () => {
	it('accepts named and custom formats only', () => {
		expect(checkTagFormat('pascal')).toBe('pascal');
		expect(checkTagFormat({ custom: 'Title Case with spaces' })).toEqual({ custom: 'Title Case with spaces' });
		expect(checkTagFormat({ custom: '  ' })).toBeUndefined();
		expect(checkTagFormat('screaming')).toBeUndefined();
	});
});

describe('checkTaggingOverrides', () => {
	it('keeps valid fields and reports invalid ones', () => {
		const result = checkTaggingOverrides(
			{ aiTagging: true, existingOnly: 'yes', format: 7, minTags: 2, maxTags: 0, preferredTags: ['a', 'b'] },
			'T',
		);
		expect(result.value).toEqual({ aiTagging: true, minTags: 2, preferredTags: ['a', 'b'] });
		expect(result.problems).toEqual([
			'T: tagging "existingOnly" must be true or false',
			'T: tag format isn\'t valid',
			'T: "maxTags" must be a whole number above 0',
		]);
	});

	it('rejects a non-object and a bad preferred-tags list', () => {
		expect(checkTaggingOverrides('on', 'T').problems).toEqual(['T: tagging settings aren\'t an object']);
		expect(checkTaggingOverrides({ preferredTags: [1] }, 'T').problems).toEqual(['T: preferred tags must be a list of text']);
	});
});

describe('checkEngine', () => {
	it('keeps every known field', () => {
		const raw = {
			id: 'e',
			name: 'LM Studio',
			provider: 'openai-compatible',
			model: 'qwen3',
			baseUrl: 'http://localhost:1234/v1',
			secretId: 'lms',
			temperature: 0.2,
			maxOutputTokens: 2048,
			contextWindow: 32768,
			contextWindowSource: 'reported',
			lmStudio: { port: 1234 },
			unknownField: 'dropped',
		};
		const { unknownField: _dropped, ...expected } = raw;
		expect(checkEngine(raw).value).toEqual(expected);
	});

	it('names everything that makes an engine unusable', () => {
		expect(checkEngine({ provider: 'openai' }).problems).toEqual(['An engine has no id', 'An engine has no name', 'An engine has no model']);
		expect(checkEngine('x').problems).toEqual(['An engine entry isn\'t an object']);
	});

	it('drops invalid optional numbers', () => {
		const engine = checkEngine({ id: 'e', name: 'n', provider: 'gemini', model: 'm', maxOutputTokens: -5, contextWindowSource: 'guess' }).value;
		expect(engine).toEqual({ id: 'e', name: 'n', provider: 'gemini', model: 'm' });
	});
});

describe('checkTemplate', () => {
	const full = {
		id: 't',
		name: 'Literature note',
		prompt: 'p',
		context: 'c',
		noteNameFormat: '{{title}}',
		noteContentFormat: '{{output}}',
		engineId: 'e',
		omitEmptyProperties: true,
		skipPreview: false,
		openAfterCreate: true,
		location: { mode: 'folder', path: 'Lit' },
		properties: [{ name: 'author', value: '{{properties.author}}', type: 'multitext' }],
		tagging: { format: 'camel' },
		references: { enabled: true, heading: '## Sources' },
		origin: { builtInId: 'literature-note', version: 1, hash: 'abc' },
	};

	it('round-trips a fully specified template', () => {
		expect(checkTemplate(full, { requireId: true })).toEqual({ value: full, problems: [] });
	});

	it('reports each invalid field and keeps the rest', () => {
		const result = checkTemplate(
			{
				id: 't',
				name: 'Bad',
				skipPreview: 'no',
				properties: [{ name: 'x', value: 1, type: 'text' }, { name: 'ok', value: 'v', type: 'text' }],
				references: { heading: 3 },
			},
			{ requireId: true },
		);
		expect(result.value).toEqual({ id: 't', name: 'Bad', properties: [{ name: 'ok', value: 'v', type: 'text' }] });
		expect(result.problems).toEqual([
			'Template "Bad": "skipPreview" must be true or false',
			'Template "Bad": a property needs a name, a text value and a known type',
			'Template "Bad": references settings aren\'t valid',
		]);
	});

	it('requires a name, and an id only when asked', () => {
		expect(checkTemplate({ id: 't' }, { requireId: true }).problems).toEqual(['A template has no name']);
		expect(checkTemplate({ name: 'Imported' }, { requireId: false }).value).toEqual({ id: '', name: 'Imported' });
		expect(checkTemplate([], { requireId: false }).problems).toEqual(['A template entry isn\'t an object']);
		expect(checkTemplate({ name: 'P', properties: {} }, { requireId: false }).problems).toEqual(['Template "P": properties must be a list']);
	});

	it('ignores an incomplete origin rather than trusting it', () => {
		expect(checkTemplate({ id: 't', name: 'n', origin: { builtInId: 'x' } }, { requireId: true }).value?.origin).toBeUndefined();
	});
});

describe('fillGlobal and fillUiState', () => {
	it('fills a missing global config from the defaults', () => {
		const global = fillGlobal(undefined).value;
		expect(global?.references).toEqual(DEFAULTS.references);
		expect(global?.noteNameFormat).toBeUndefined();
		expect(fillGlobal({ noteNameFormat: '{{date}} {{title}}', collision: 'ask' }).value).toMatchObject({
			noteNameFormat: '{{date}} {{title}}',
			collision: 'ask',
		});
	});

	it('forgets unusable popup state', () => {
		expect(fillUiState('x')).toEqual({});
		expect(fillUiState({ lastTemplateId: 't', lastLocation: { mode: 'alongside' } })).toEqual({
			lastTemplateId: 't',
			lastLocation: { mode: 'alongside' },
		});
	});
});
