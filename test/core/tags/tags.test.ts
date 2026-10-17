import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../../src/core/defaults';
import { formatTag } from '../../../src/core/tags/format';
import { splitWords, tagFold, tagKey } from '../../../src/core/tags/normalize';
import { buildTags, type TagPipelineInput, type TagPipelineSettings } from '../../../src/core/tags/pipeline';
import { makeTagValid } from '../../../src/core/tags/validate';

const defaults: TagPipelineSettings = { ...DEFAULTS.tagging };

function run(input: Partial<Omit<TagPipelineInput, 'settings'>>, settings: Partial<TagPipelineSettings> = {}) {
	return buildTags({
		sourceFrontmatter: [],
		sourceInline: [],
		template: [],
		ai: [],
		vaultTags: [],
		...input,
		settings: { ...defaults, ...settings },
	});
}

describe('tagKey and tagFold', () => {
	it('treats separators, case boundaries and # as equivalent (12.0.2)', () => {
		const key = 'ai machine learning';
		for (const tag of ['ai/machine-learning', 'ai-machine-learning', 'AiMachineLearning', 'ai_machine_learning', '#Ai/Machine Learning']) {
			expect(tagKey(tag)).toBe(key);
		}
	});

	it('keeps digits attached to their letters', () => {
		expect(splitWords('y1984')).toEqual(['y1984']);
		expect(splitWords('3D-printing')).toEqual(['3D', 'printing']);
		expect(splitWords('web3Dev')).toEqual(['web3', 'Dev']);
		expect(splitWords('HTMLParser')).toEqual(['HTML', 'Parser']);
	});

	it('folds case the way Obsidian compares tags', () => {
		expect(tagFold('#DevOps')).toBe(tagFold('devops'));
		expect(tagKey('DevOps')).not.toBe(tagKey('devops'));
	});
});

describe('formatTag', () => {
	it('converts each segment and keeps nesting (13.0.3)', () => {
		expect(formatTag('Machine Learning', 'kebab')).toBe('machine-learning');
		expect(formatTag('ai/machine learning', 'camel')).toBe('ai/machineLearning');
		expect(formatTag('ai/machine learning', 'pascal')).toBe('Ai/MachineLearning');
		expect(formatTag('Ai Machine-Learning', 'snake')).toBe('ai_machine_learning');
		expect(formatTag('#XMLHttpRequest', 'kebab')).toBe('xml-http-request');
	});

	it('leaves a custom format to the model', () => {
		expect(formatTag('#Title Case Tag', { custom: 'Title Case' })).toBe('Title Case Tag');
	});
});

describe('makeTagValid (13.0.4, 13.0.5)', () => {
	it('replaces spaces with the format\'s separator', () => {
		expect(makeTagValid('my tag', 'kebab')).toEqual({ ok: true, tag: 'my-tag' });
		expect(makeTagValid('my tag', 'snake')).toEqual({ ok: true, tag: 'my_tag' });
		expect(makeTagValid('my tag', 'camel')).toEqual({ ok: true, tag: 'myTag' });
		expect(makeTagValid('my  tag', { custom: 'whatever' })).toEqual({ ok: true, tag: 'my-tag' });
	});

	it('strips disallowed characters, collapses separators and trims ends', () => {
		expect(makeTagValid('C++ & Node.js!', 'kebab')).toEqual({ ok: true, tag: 'C-Nodejs' });
		expect(makeTagValid('--a--b__c//d-/', 'kebab')).toEqual({ ok: true, tag: 'a-b_c/d' });
		expect(makeTagValid('#café', 'kebab')).toEqual({ ok: true, tag: 'café' });
		expect(makeTagValid('日本語', 'kebab')).toEqual({ ok: true, tag: '日本語' });
	});

	it('keeps emoji, including joined and modified sequences', () => {
		for (const emoji of ['🚀', '👩‍💻', '👍🏽', '🇫🇷', '❤️']) {
			expect(makeTagValid(`fun${emoji}`, 'kebab')).toEqual({ ok: true, tag: `fun${emoji}` });
		}
	});

	it('drops purely numeric and empty tags; keeps y1984 (13.4)', () => {
		expect(makeTagValid('1984', 'kebab')).toEqual({ ok: false, reason: 'invalid' });
		expect(makeTagValid('#!!', 'kebab')).toEqual({ ok: false, reason: 'invalid' });
		expect(makeTagValid('y1984', 'kebab')).toEqual({ ok: true, tag: 'y1984' });
	});
});

describe('buildTags: merging (REQ-11)', () => {
	it('merges frontmatter, then inline tags, keeping spelling (11.1, 11.3)', () => {
		expect(run({ sourceFrontmatter: ['Project', 'area/work'], sourceInline: ['idea'] }).tags).toEqual(['Project', 'area/work', 'idea']);
	});

	it('adds no source tags with merging off (11.2)', () => {
		expect(run({ sourceFrontmatter: ['Project'], sourceInline: ['idea'], template: ['summary'] }, { mergeSourceTags: false }).tags).toEqual([
			'summary',
		]);
	});

	it('orders frontmatter, inline, template, then AI (11.0.2)', () => {
		expect(run({ ai: ['zeta'], template: ['tpl'], sourceInline: ['inline'], sourceFrontmatter: ['fm'] }).tags).toEqual([
			'fm',
			'inline',
			'tpl',
			'zeta',
		]);
	});
});

describe('buildTags: dedup (REQ-12)', () => {
	it('keeps the frontmatter spelling over inline (12.1)', () => {
		expect(run({ sourceFrontmatter: ['#Project'], sourceInline: ['project'] }).tags).toEqual(['Project']);
	});

	it('merges separator and case variants into the highest-precedence spelling (12.2)', () => {
		expect(run({ ai: ['machineLearning'], template: ['machine_learning'], sourceInline: ['machine-learning'] }).tags).toEqual([
			'machine-learning',
		]);
		expect(run({ ai: ['machine-learning', 'machineLearning'], template: ['machine_learning'] }).tags).toEqual(['machine_learning']);
	});

	it('prefers the source spelling over a nested AI tag (12.3)', () => {
		expect(run({ sourceFrontmatter: ['ai-machine-learning'], ai: ['ai/machine-learning'] }).tags).toEqual(['ai-machine-learning']);
	});

	it('prefers the nested form among AI-only tags (12.4)', () => {
		expect(run({ ai: ['ai-machine-learning', 'ai/machine-learning'] }).tags).toEqual(['ai/machine-learning']);
	});

	it('dedups within the source\'s own tags (12.0.4)', () => {
		expect(run({ sourceFrontmatter: ['a', 'A', 'b'], sourceInline: ['B', 'a'] }).tags).toEqual(['a', 'b']);
	});

	it('treats a case-only difference as the same tag, as Obsidian does', () => {
		expect(run({ sourceFrontmatter: ['DevOps'], ai: ['devops', 'dev-ops'] }).tags).toEqual(['DevOps']);
	});
});

describe('buildTags: formats and validity (REQ-13)', () => {
	it('converts AI tags to kebab-case (13.1)', () => {
		expect(run({ ai: ['Machine Learning'] }).tags).toEqual(['machine-learning']);
	});

	it('converts AI tags to camelCase per segment (13.2)', () => {
		expect(run({ ai: ['ai/machine learning'] }, { format: 'camel' }).tags).toEqual(['ai/machineLearning']);
	});

	it('drops 1984, keeps y1984, and reports the drop (13.4)', () => {
		const result = run({ ai: ['1984', 'y1984'] });
		expect(result.tags).toEqual(['y1984']);
		expect(result.dropped).toEqual([{ tag: '1984', reason: 'invalid' }]);
	});

	it('formats source tags only when asked (13.5)', () => {
		expect(run({ sourceFrontmatter: ['My_Tag'] }).tags).toEqual(['My_Tag']);
		expect(run({ sourceFrontmatter: ['My_Tag'] }, { applyFormatToSource: true }).tags).toEqual(['my-tag']);
	});

	it('keeps a reused vault tag\'s spelling under kebab-case (13.6)', () => {
		expect(run({ ai: ['dev ops'], vaultTags: ['DevOps'] }).tags).toEqual(['DevOps']);
		expect(run({ ai: ['devops'], vaultTags: ['#DevOps'] }).tags).toEqual(['DevOps']);
	});

	it('prefers the most used vault spelling', () => {
		expect(run({ ai: ['dev ops'], vaultTags: ['dev-ops', 'DevOps'] }).tags).toEqual(['dev-ops']);
	});

	it('keeps custom-format AI tags as written, only made valid', () => {
		expect(run({ ai: ['Deep Work.'] }, { format: { custom: 'Title Case' } }).tags).toEqual(['Deep-Work']);
	});
});

describe('buildTags: AI tagging rules (REQ-14)', () => {
	it('caps AI tags at the maximum after dedup against source tags (14.2)', () => {
		const ai = ['one', 'two', 'three', 'Project', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
		const result = run({ sourceFrontmatter: ['Project'], ai }, { maxTags: 7 });
		expect(result.tags).toEqual(['Project', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']);
	});

	it('discards invented tags in existing-only mode (14.3)', () => {
		const result = run({ ai: ['reading', 'quantum-baking'], vaultTags: ['reading'] }, { existingOnly: true });
		expect(result.tags).toEqual(['reading']);
		expect(result.dropped).toEqual([{ tag: 'quantum-baking', reason: 'not-in-vault' }]);
	});

	it('flattens nested AI tags when prefixes are off (14.5)', () => {
		expect(run({ ai: ['ai/agents'] }, { hierarchicalPrefixes: false }).tags).toEqual(['ai-agents']);
		expect(run({ ai: ['ai/agents'], vaultTags: ['ai/agents'] }, { hierarchicalPrefixes: false }).tags).toEqual(['ai-agents']);
	});

	it('matches nested vault tags in existing-only mode even when flattening', () => {
		expect(run({ ai: ['ai/agents'], vaultTags: ['ai/agents'] }, { hierarchicalPrefixes: false, existingOnly: true }).tags).toEqual([
			'ai-agents',
		]);
	});

	it('ignores blank AI tags', () => {
		expect(run({ ai: ['', '  ', '#'] })).toEqual({ tags: [], dropped: [] });
	});
});
