import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatTag } from '../../../src/core/tags/format';
import { tagFold, tagKey } from '../../../src/core/tags/normalize';
import { buildTags, type TagPipelineSettings } from '../../../src/core/tags/pipeline';
import { makeTagValid } from '../../../src/core/tags/validate';

/**
 * Property tests for 12.5: whatever mix of source, template and AI tags comes
 * in, in whatever formats and cases, the output never repeats a tag.
 */

const word = fc.constantFrom('machine', 'learning', 'ai', 'dev', 'ops', 'project', 'idea', 'y1984', '1984', 'café', '日本', 'x');
const separator = fc.constantFrom('-', '_', ' ', '/', '');

/** Tags built from a small vocabulary, so collisions are frequent. */
const tag = fc
	.tuple(fc.constantFrom('', '#'), fc.array(fc.tuple(word, separator), { minLength: 1, maxLength: 4 }), fc.boolean())
	.map(([hash, parts, shout]) => {
		const text = parts.map(([w, s]) => w + s).join('');
		return hash + (shout ? text.toUpperCase() : text);
	});

/** Also mixes in arbitrary strings, to catch anything the vocabulary misses. */
const anyTag = fc.oneof({ weight: 4, arbitrary: tag }, { weight: 1, arbitrary: fc.string({ maxLength: 12 }) });

const format = fc.constantFrom<TagPipelineSettings['format']>('kebab', 'snake', 'camel', 'pascal', { custom: 'Title Case' });

const settings: fc.Arbitrary<TagPipelineSettings> = fc.record({
	mergeSourceTags: fc.boolean(),
	format,
	applyFormatToSource: fc.boolean(),
	hierarchicalPrefixes: fc.boolean(),
	existingOnly: fc.boolean(),
	maxTags: fc.integer({ min: 1, max: 10 }),
});

const input = fc.record({
	sourceFrontmatter: fc.array(anyTag, { maxLength: 6 }),
	sourceInline: fc.array(anyTag, { maxLength: 6 }),
	template: fc.array(anyTag, { maxLength: 4 }),
	ai: fc.array(anyTag, { maxLength: 15 }),
	vaultTags: fc.array(anyTag, { maxLength: 10 }),
	settings,
});

describe('buildTags properties (12.5)', () => {
	it('never outputs two tags with the same key or the same case-folded spelling', () => {
		fc.assert(
			fc.property(input, (i) => {
				const { tags } = buildTags(i);
				expect(new Set(tags.map(tagKey)).size).toBe(tags.length);
				expect(new Set(tags.map(tagFold)).size).toBe(tags.length);
			}),
			{ numRuns: 2000 },
		);
	});

	it('only outputs valid tags', () => {
		fc.assert(
			fc.property(input, (i) => {
				for (const t of buildTags(i).tags) {
					expect(makeTagValid(t, i.settings.format)).toEqual({ ok: true, tag: t });
					expect(t).not.toMatch(/^#|\s/u);
				}
			}),
			{ numRuns: 2000 },
		);
	});

	it('keeps every valid source tag\'s key when merging is on', () => {
		fc.assert(
			fc.property(input, (i) => {
				const settingsOn = { ...i.settings, mergeSourceTags: true };
				const { tags } = buildTags({ ...i, settings: settingsOn });
				const keys = new Set(tags.map(tagKey));
				const folds = new Set(tags.map(tagFold));
				for (const source of [...i.sourceFrontmatter, ...i.sourceInline]) {
					const prepared = settingsOn.applyFormatToSource ? formatTag(source, settingsOn.format) : source;
					const valid = makeTagValid(prepared, settingsOn.format);
					if (valid.ok) expect(keys.has(tagKey(valid.tag)) || folds.has(tagFold(valid.tag))).toBe(true);
				}
			}),
			{ numRuns: 2000 },
		);
	});

	it('never lets AI contribute more than maxTags tags', () => {
		fc.assert(
			fc.property(input, (i) => {
				const withoutAi = buildTags({ ...i, ai: [] }).tags;
				const withAi = buildTags(i).tags;
				expect(withAi.length - withoutAi.length).toBeLessThanOrEqual(i.settings.maxTags);
				// AI tags only ever add to the list; they never displace source or template tags.
				expect(withAi.slice(0, withoutAi.length)).toEqual(withoutAi);
			}),
			{ numRuns: 2000 },
		);
	});

	it('is idempotent: feeding the output back as source tags changes nothing', () => {
		fc.assert(
			fc.property(input, (i) => {
				const { tags } = buildTags(i);
				const again = buildTags({
					sourceFrontmatter: tags,
					sourceInline: [],
					template: [],
					ai: [],
					vaultTags: [],
					settings: { ...i.settings, mergeSourceTags: true, applyFormatToSource: false },
				});
				expect(again.tags).toEqual(tags);
			}),
			{ numRuns: 1000 },
		);
	});
});
