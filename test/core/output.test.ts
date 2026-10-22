import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { numbered, sanitizeFilename } from '../../src/core/filename';
import {
	addReferenceLink,
	blankLineAfterHeadings,
	assembleNote,
	coerceProperty,
	prepareOutput,
	splitLeadingFrontmatter,
	splitList,
	stripEnclosingFence,
	tagList,
	typeProperties,
	type AssembleInput,
} from '../../src/core/output';

const parseYaml = (text: string): unknown => YAML.parse(text);
const stringifyYaml = (value: unknown): string => YAML.stringify(value);

function assemble(input: Partial<AssembleInput>): string {
	return assembleNote({ body: 'Body', properties: [], aiProperties: {}, tags: [], omitEmptyProperties: false, stringifyYaml, ...input });
}

describe('stripEnclosingFence (8.0.5)', () => {
	it('removes a markdown fence around the whole response (8.3)', () => {
		expect(stripEnclosingFence('```markdown\n# Title\n\nText\n```')).toBe('# Title\n\nText');
		expect(stripEnclosingFence('\n  ```\nplain\n```  \n')).toBe('plain');
		expect(stripEnclosingFence('~~~md\nx\n~~~')).toBe('x');
		expect(stripEnclosingFence('````markdown\nSee:\n```js\ncode\n```\n````')).toBe('See:\n```js\ncode\n```');
	});

	it('leaves responses with text around a fence, or several blocks', () => {
		const around = 'Here you go:\n```markdown\n# Title\n```';
		expect(stripEnclosingFence(around)).toBe(around);
		const two = '```\na\n```\n\n```\nb\n```';
		expect(stripEnclosingFence(two)).toBe(two);
		expect(stripEnclosingFence('```\nunclosed')).toBe('```\nunclosed');
		expect(stripEnclosingFence('no fence')).toBe('no fence');
		expect(stripEnclosingFence('```')).toBe('```');
	});
});

describe('splitLeadingFrontmatter and prepareOutput (8.0.7)', () => {
	it('splits off frontmatter and hands its tags to the pipeline (8.6)', () => {
		const prepared = prepareOutput('---\nstatus: draft\ntags: [x]\n---\n# Note\n\nText', parseYaml);
		expect(prepared).toEqual({ body: '# Note\n\nText', properties: { status: 'draft' }, tags: ['x'] });
	});

	it('handles a fenced response that starts with frontmatter', () => {
		const prepared = prepareOutput('```markdown\n---\nTags: a, b\n---\nBody\n```', parseYaml);
		expect(prepared).toEqual({ body: 'Body', properties: {}, tags: ['a', 'b'] });
	});

	it('leaves a leading block that isn\'t a YAML mapping in the body', () => {
		expect(splitLeadingFrontmatter('---\n- just\n- a list\n---\nText', parseYaml)).toEqual({ body: '---\n- just\n- a list\n---\nText' });
		expect(splitLeadingFrontmatter('---\nkey: [unclosed\n---\nText', parseYaml).data).toBeUndefined();
		expect(splitLeadingFrontmatter('Text\n---\na: 1\n---', parseYaml)).toEqual({ body: 'Text\n---\na: 1\n---' });
	});
});

describe('property typing', () => {
	it('splits multitext on ", " without breaking wikilinks', () => {
		expect(splitList('[[Lovelace, Ada]], [[Babbage]]')).toEqual(['[[Lovelace, Ada]]', '[[Babbage]]']);
		expect(splitList('["a","b"]')).toEqual(['a', 'b']);
		expect(splitList('[not json')).toEqual(['[not json']);
		expect(coerceProperty('a, b,c', 'multitext')).toEqual(['a', 'b,c']);
	});

	it('coerces numbers, checkboxes, dates and datetimes, falling back to text', () => {
		expect(coerceProperty(' 42 ', 'number')).toBe(42);
		expect(coerceProperty('many', 'number')).toBe('many');
		expect(coerceProperty('Yes', 'checkbox')).toBe(true);
		expect(coerceProperty('false', 'checkbox')).toBe(false);
		expect(coerceProperty('maybe', 'checkbox')).toBe('maybe');
		expect(coerceProperty('2026-03-01', 'date')).toBe('2026-03-01');
		expect(coerceProperty('2026-03-01T10:20:00Z', 'date')).toBe('2026-03-01');
		expect(coerceProperty('March 1st', 'date')).toBe('March 1st');
		expect(coerceProperty('2026-03-01 10:20', 'datetime')).toBe('2026-03-01T10:20');
		expect(coerceProperty('2026-03-01', 'datetime')).toBe('2026-03-01T00:00');
		expect(coerceProperty('soon', 'datetime')).toBe('soon');
		expect(coerceProperty('2026-03-01 at noon', 'datetime')).toBe('2026-03-01 at noon');
		expect(coerceProperty('  ', 'text')).toBeNull();
		expect(coerceProperty('', 'multitext')).toEqual([]);
		expect(coerceProperty('kept as is ', 'text')).toBe('kept as is ');
	});

	it('takes a tags property out of the frontmatter and into the template tags', () => {
		expect(
			typeProperties([
				{ name: 'status', value: 'draft', type: 'text' },
				{ name: 'tags', value: 'flashcards, study', type: 'multitext' },
			]),
		).toEqual({ properties: [{ name: 'status', value: 'draft' }], templateTags: ['flashcards', 'study'] });
		expect(tagList('#a #b, c')).toEqual(['#a', '#b', 'c']);
		expect(tagList(['a', 1, { x: 1 }])).toEqual(['a', '1']);
		expect(tagList(7)).toEqual([]);
	});
});

describe('addReferenceLink (10.0.5, 10.0.6)', () => {
	it('adds the heading at the end when the note lacks it (10.5)', () => {
		expect(addReferenceLink('# Title\n\nText\n', '# References', '[[Alpha]]')).toBe('# Title\n\nText\n\n# References\n\n- [[Alpha]]\n');
		expect(addReferenceLink('', '# References', '[[Alpha]]')).toBe('# References\n\n- [[Alpha]]\n');
	});

	it('uses an existing heading instead of adding a second one (10.6)', () => {
		const body = '# Summary\n\nText\n\n# References   \n- [[Other]]\n\n# Appendix\n\nMore';
		expect(addReferenceLink(body, '# References', '[[Alpha]]')).toBe(
			'# Summary\n\nText\n\n# References   \n- [[Other]]\n- [[Alpha]]\n\n# Appendix\n\nMore',
		);
	});

	it('keeps subheadings inside the section', () => {
		const body = '# References\n## Books\n- [[B]]\n\n## Papers\n- [[P]]';
		expect(addReferenceLink(body, '# References', '[[Alpha]]')).toBe(`${body}\n- [[Alpha]]`);
	});

	it('uses a custom heading such as ## Sources (10.7)', () => {
		expect(addReferenceLink('Text', '## Sources', '[[Alpha]]')).toBe('Text\n\n## Sources\n\n- [[Alpha]]\n');
		expect(addReferenceLink('## Sources\n- a\n### Sub\n- b\n## Next', '## Sources', 'L')).toBe('## Sources\n- a\n### Sub\n- b\n- L\n## Next');
	});

	it('ignores a heading inside a code block', () => {
		const body = '```md\n# References\n```\nText';
		expect(addReferenceLink(body, '# References', '[[Alpha]]')).toBe(`${body}\n\n# References\n\n- [[Alpha]]\n`);
	});

	it('treats a heading setting without # as a plain line ended by any heading', () => {
		expect(addReferenceLink('Sources\n- a\n#### Next', 'Sources', 'L')).toBe('Sources\n- a\n- L\n#### Next');
	});
});

describe('blankLineAfterHeadings', () => {
	it('puts a blank line after every heading that lacks one', () => {
		expect(blankLineAfterHeadings('## Summary\nText\n## Key points\n- A\n### Sub\n- B')).toBe('## Summary\n\nText\n## Key points\n\n- A\n### Sub\n\n- B');
		expect(blankLineAfterHeadings('# Title\n## Section\nText')).toBe('# Title\n\n## Section\n\nText');
	});

	it('leaves headings that already have one, and a heading at the end, alone', () => {
		const text = '## Summary\n\nText\n\n## End';
		expect(blankLineAfterHeadings(text)).toBe(text);
		expect(blankLineAfterHeadings('## Summary\n   \nText')).toBe('## Summary\n   \nText');
	});

	it('ignores headings in code blocks, tags and other lines that only start with #', () => {
		const text = '```md\n# Inside\ntext\n```\n#tag on a line\n    # indented code\ntext\n#hashtag';
		expect(blankLineAfterHeadings(text)).toBe(text);
	});
});

describe('assembleNote: leading images', () => {
	it('puts the images first, then a blank line, then the body', () => {
		expect(assemble({ body: '## Summary\nText', leadingImages: ['![[a.png]]', '![[b.png|200]]'] })).toBe('![[a.png]]\n![[b.png|200]]\n\n## Summary\n\nText\n');
		expect(assemble({ body: '', leadingImages: ['![[a.png]]'], references: { heading: '# References', link: '[[S]]' } })).toBe(
			'![[a.png]]\n\n# References\n\n- [[S]]\n',
		);
		expect(assemble({ leadingImages: [] })).toBe('Body\n');
	});
});

describe('assembleNote', () => {
	it('puts a blank line after every heading in the note, its own and the references heading', () => {
		const text = assemble({ body: '## Summary\nText\n# References\n- [[Other]]', references: { heading: '# References', link: '[[Alpha]]' } });
		expect(text).toBe('## Summary\n\nText\n# References\n\n- [[Other]]\n- [[Alpha]]\n');
	});

	it('writes frontmatter with the final tags and the body (9.1)', () => {
		const text = assemble({
			properties: [{ name: 'status', value: 'draft' }],
			tags: ['Project', 'x'],
			references: { heading: '# References', link: '[[Alpha]]' },
		});
		expect(text).toBe('---\nstatus: draft\ntags:\n  - Project\n  - x\n---\nBody\n\n# References\n\n- [[Alpha]]\n');
	});

	it('merges AI frontmatter under template properties (8.7)', () => {
		const text = assemble({ properties: [{ name: 'status', value: 'final' }], aiProperties: { Status: 'draft', mood: 'calm' } });
		expect(YAML.parse(text.split('---')[1]!)).toEqual({ status: 'final', mood: 'calm' });
	});

	it('leaves out empty properties when asked (15.8)', () => {
		const properties = [
			{ name: 'source', value: null },
			{ name: 'author', value: [] },
			{ name: 'created', value: '2026-10-17' },
		];
		expect(assemble({ properties, omitEmptyProperties: true })).toBe('---\ncreated: 2026-10-17\n---\nBody\n');
		expect(assemble({ properties, omitEmptyProperties: false })).toContain('source: null');
	});

	it('writes no frontmatter when there is nothing to write', () => {
		expect(assemble({ body: 'Just text\n' })).toBe('Just text\n');
	});

	it('copes with a YAML writer that omits the final newline', () => {
		expect(assemble({ tags: ['a'], stringifyYaml: () => 'tags: [a]' })).toBe('---\ntags: [a]\n---\nBody\n');
	});
});

describe('filenames (10.0.3)', () => {
	it('removes characters that aren\'t allowed (10.3)', () => {
		expect(sanitizeFilename('Q3: what next?')).toBe('Q3 what next');
		expect(sanitizeFilename('a\\b/c*d"e<f>g|h#i^j[k]l')).toBe('abcdefghijkl');
		expect(sanitizeFilename('  ..hidden\nname  ')).toBe('hidden name');
		expect(sanitizeFilename('???')).toBe('Untitled');
		expect([...sanitizeFilename('x'.repeat(500))]).toHaveLength(200);
	});

	it('numbers collisions the way Obsidian does', () => {
		expect(numbered('Alpha - Summary', 0)).toBe('Alpha - Summary');
		expect(numbered('Alpha - Summary', 1)).toBe('Alpha - Summary 1');
	});
});
