import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { BUILT_INS, type BuiltInTemplate } from '../../src/core/builtins';
import { READING_GUIDANCE } from '../../src/core/builtins/reading-guidance';
import { composeNote, copiedProperties } from '../../src/core/compose';
import { defaultGlobalSettings } from '../../src/core/defaults';
import { resolveRunConfig } from '../../src/core/resolve';
import type { Template } from '../../src/core/schema';
import {
	duplicateTemplate,
	hashTemplate,
	instantiateBuiltIn,
	restoreBuiltIns,
	seedBuiltIns,
	uniqueName,
	upgradeBuiltIns,
} from '../../src/core/templates';
import { snapshot } from '../fixtures/notes';

let counter = 0;
const newId = () => `id-${++counter}`;
const now = new Date(2026, 9, 17, 9, 0, 0);
const yaml = { parse: (t: string): unknown => YAML.parse(t), stringify: (v: unknown) => YAML.stringify(v) };
const builtIn = (id: string) => instantiateBuiltIn(BUILT_INS.find((b) => b.builtInId === id)!, id);

/** Runs a template on a note with a recorded model response, the way the run controller will. */
async function derive(template: Template, note = snapshot('Notes/Plain.md', 'Plain note text.'), mainOutput = 'Output') {
	const { config } = resolveRunConfig({ popup: {}, template, globalSettings: defaultGlobalSettings(), engines: [] });
	const composed = await composeNote({ config, note, now, mainOutput, answers: new Map(), aiTags: [], vaultTags: [], yaml });
	const text = composed.assemble({ link: '[[Plain]]' });
	const frontmatter = YAML.parse(/^---\n([\s\S]*?)\n---/u.exec(text)?.[1] ?? '') as Record<string, unknown>;
	return { text, frontmatter, composed };
}

describe('the built-in templates (REQ-15)', () => {
	it('seeds all five (15.1)', () => {
		expect(seedBuiltIns(newId).map((t) => t.name)).toEqual(['Comprehensive summary', 'Key points / TL;DR', 'Action items', 'Flashcards', 'Literature note']);
	});

	it('puts the reading guidance in every prompt (15.3)', () => {
		for (const b of BUILT_INS) expect(b.template.prompt, b.builtInId).toContain(READING_GUIDANCE);
		expect(READING_GUIDANCE).toMatch(/frontmatter.*context/su);
		expect(READING_GUIDANCE).toMatch(/\[\[wikilinks\]\]/u);
	});

	it('keeps the summarizer\'s sections, without its transcription guidance (15.0.1)', () => {
		const prompt = builtIn('comprehensive-summary').prompt!;
		for (const section of ['## Summary', '## Key points', '## Technical terms', '## Actionable insights', '## Conclusion']) expect(prompt).toContain(section);
		expect(prompt).not.toMatch(/transcription|subtitle/iu);
	});

	it('shows a blank line after every heading in each prompt, its example output included', () => {
		for (const b of BUILT_INS) {
			const lines = b.template.prompt!.split('\n');
			lines.forEach((line, i) => {
				if (/^#{1,6} /u.test(line)) expect(lines[i + 1], `${b.builtInId}: ${line}`).toBe('');
			});
		}
	});

	it('writes a blank line after each heading of a response that has none', async () => {
		const { text } = await derive(builtIn('action-items'), undefined, '## Action items\n- [ ] Ship it\n## Decisions\n- Ship Friday');
		expect(text).toContain('## Action items\n\n- [ ] Ship it\n## Decisions\n\n- Ship Friday');
	});

	it('carries the source\'s leading images, unless the output shows them or the setting is off (Q43, Q46)', async () => {
		const note = snapshot('Notes/Dune.md', '![[cover.png]] ![[map.png]]\n\nNotes on Dune.');
		const images = [
			{ embed: '![[cover.png]]', targets: ['cover.png'] },
			{ embed: '![[map.png]]', targets: ['map.png', 'Attachments/map.png'] },
		];
		const { composed } = await derive(builtIn('key-points'), note, '**TL;DR:** A desert.\n\n![[Attachments/Map.png]]');
		expect(composed.leadingImages.map((image) => image.target)).toEqual(['cover.png', 'map.png']);
		const text = composed.assemble({ images });
		expect(text.split('---\n')[2]).toBe('![[cover.png]]\n\n**TL;DR:** A desert.\n\n![[Attachments/Map.png]]\n');

		const off = await derive({ ...builtIn('key-points'), carryImages: false }, note);
		expect(off.composed.leadingImages).toEqual([]);
		expect(off.composed.assemble({ images })).not.toContain('cover.png');
	});

	it('copies the source\'s properties, minus tags and excluded ones, under the template\'s (Q47, Q48)', async () => {
		const note = snapshot('Notes/Dune.md', 'x', {
			tags: ['books'],
			Aliases: ['Dune notes'],
			cssclasses: ['wide'],
			created: '2020-01-01',
			status: 'draft',
			Type: 'book',
			read: new Date(Date.UTC(2026, 2, 1)),
			finished: new Date(Date.UTC(2026, 2, 1, 21, 30)),
			meta: { pages: 412, when: new Date(Date.UTC(2026, 0, 2)) },
		});
		const { frontmatter } = await derive(builtIn('key-points'), note);
		expect(frontmatter).toEqual({
			created: '2026-10-17',
			status: 'draft',
			Type: 'book',
			read: '2026-03-01',
			finished: '2026-03-01T21:30',
			meta: { pages: 412, when: '2026-01-02' },
		});

		expect(copiedProperties(note, ['TYPE', 'status'])).not.toHaveProperty('Type');
		expect(copiedProperties(snapshot('A.md', 'x', { bad: new Date(Number.NaN) }), [])).toEqual({ bad: '' });
		const off = await derive({ ...builtIn('key-points'), carryProperties: false }, note);
		expect(off.frontmatter).toEqual({ created: '2026-10-17' });
	});

	it('turns carrying images and frontmatter off where it doesn\'t fit (Q51)', async () => {
		const carry = (id: string) => {
			const { template } = BUILT_INS.find((b) => b.builtInId === id)!;
			return [template.carryImages, template.carryProperties];
		};
		expect(carry('comprehensive-summary')).toEqual([undefined, undefined]);
		expect(carry('key-points')).toEqual([undefined, undefined]);
		expect(carry('literature-note')).toEqual([undefined, undefined]);
		expect(carry('action-items')).toEqual([false, undefined]);
		expect(carry('flashcards')).toEqual([false, false]);

		const note = snapshot('Bio.md', '![[cell.png]]\n\nCells.', { status: 'draft' });
		const { frontmatter, composed } = await derive(builtIn('flashcards'), note, 'What is a cell?::The basic unit of life');
		expect(frontmatter).toEqual({ tags: ['flashcards'], created: '2026-10-17' });
		expect(composed.leadingImages).toEqual([]);
	});

	it('upgrades unedited Action items and Flashcards copies to the new defaults', () => {
		const oldCopies = BUILT_INS.filter((b) => b.builtInId === 'action-items' || b.builtInId === 'flashcards').map((b) => {
			const { carryImages: _images, carryProperties: _properties, ...older } = b.template;
			return instantiateBuiltIn({ ...b, version: b.version - 1, template: older }, b.builtInId);
		});
		const { templates, upgraded } = upgradeBuiltIns(oldCopies, BUILT_INS);
		expect(upgraded).toEqual(['Action items', 'Flashcards']);
		expect(templates.map((t) => [t.carryImages, t.carryProperties])).toEqual([
			[false, undefined],
			[false, false],
		]);
	});

	it('adds a created date with the run\'s date to every built-in (15.9)', async () => {
		for (const b of BUILT_INS) {
			const { frontmatter } = await derive(builtIn(b.builtInId));
			expect(frontmatter.created, b.builtInId).toBe('2026-10-17');
		}
	});

	it('produces a summary with its sections from a recorded response (15.2)', async () => {
		const response = '```markdown\n## Summary\nThe team ships.\n\n## Key points\n- A\n\n## Actionable insights\n- Do B\n\n## Conclusion\nDone.\n```';
		const { text } = await derive(builtIn('comprehensive-summary'), undefined, response);
		for (const section of ['## Summary', '## Key points', '## Actionable insights', '## Conclusion']) expect(text).toContain(section);
		expect(text).not.toContain('```');
		expect(text.trimEnd().endsWith('# References\n\n- [[Plain]]')).toBe(true);
	});

	it('writes flashcards as Question::Answer lines with the flashcards tag (15.6)', async () => {
		const note = snapshot('Bio.md', '---\ntags: [biology]\n---\nCells.', {}, { frontmatterTags: ['biology'] });
		const { text, frontmatter } = await derive(builtIn('flashcards'), note, 'What is a cell?::The basic unit of life\nWhat holds DNA?::The nucleus');
		expect(frontmatter.tags).toEqual(['biology', 'flashcards']);
		const lines = text.split('---\n')[2]!.split('\n').filter((l) => l.includes('::'));
		expect(lines).toEqual(['What is a cell?::The basic unit of life', 'What holds DNA?::The nucleus']);
	});

	it('carries a clipping\'s source, author and published over with their types (15.7)', async () => {
		const clipping = snapshot('Clippings/Engines.md', '---\nsource: https://example.com/engines\n---\nText', {
			source: 'https://example.com/engines',
			author: ['[[Ada Lovelace]]'],
			// Obsidian's YAML parser can return an unquoted date as a Date.
			published: new Date(Date.UTC(2026, 2, 1)),
		});
		const { frontmatter } = await derive(builtIn('literature-note'), clipping);
		expect(frontmatter).toEqual({ source: 'https://example.com/engines', author: ['[[Ada Lovelace]]'], published: '2026-03-01', created: '2026-10-17' });

		const single = snapshot('Clippings/One.md', 'x', { author: '[[Ada Lovelace]]', published: '2026-03-01' });
		expect((await derive(builtIn('literature-note'), single)).frontmatter).toMatchObject({ author: ['[[Ada Lovelace]]'], published: '2026-03-01' });
	});

	it('writes no empty source, author or published on a plain note (15.8)', async () => {
		const { frontmatter } = await derive(builtIn('literature-note'));
		expect(frontmatter).toEqual({ created: '2026-10-17' });
	});

	it('names the Key points output without the slash in its template name', async () => {
		expect((await derive(builtIn('key-points'))).composed.fileName).toBe('Plain - Key points');
	});
});

describe('template management', () => {
	it('duplicates a built-in into an editable copy and keeps the original (15.4)', () => {
		const original = builtIn('action-items');
		const copy = duplicateTemplate(original, 'copy-id', ['Action items']);
		expect(copy).toMatchObject({ id: 'copy-id', name: 'Action items copy', prompt: original.prompt });
		expect(copy.origin).toBeUndefined();
		expect(original.origin?.builtInId).toBe('action-items');
		expect(duplicateTemplate(original, 'x', ['Action items copy']).name).toBe('Action items copy 1');
	});

	it('upgrades an unedited copy and keeps an edited one (15.5)', () => {
		const v1: BuiltInTemplate = { builtInId: 'demo', version: 1, template: { name: 'Demo', prompt: 'Old prompt' } };
		const v2: BuiltInTemplate = { builtInId: 'demo', version: 2, template: { name: 'Demo', prompt: 'New prompt' } };
		const unedited = instantiateBuiltIn(v1, 'a');
		const edited = { ...instantiateBuiltIn(v1, 'b'), prompt: 'My own prompt' };
		const user: Template = { id: 'c', name: 'Mine', prompt: 'x' };
		const { templates, upgraded } = upgradeBuiltIns([unedited, edited, user], [v2]);
		expect(templates[0]).toMatchObject({ id: 'a', prompt: 'New prompt', origin: { version: 2 } });
		expect(templates[1]).toBe(edited);
		expect(templates[2]).toBe(user);
		expect(upgraded).toEqual(['Demo']);
		// Already current: nothing changes.
		expect(upgradeBuiltIns([templates[0]!], [v2]).upgraded).toEqual([]);
		// A built-in that no longer ships is left alone.
		expect(upgradeBuiltIns([unedited], []).templates[0]).toBe(unedited);
	});

	it('hashes content only, independent of key order', () => {
		expect(hashTemplate({ name: 'A', prompt: 'p' })).toBe(hashTemplate({ prompt: 'p', name: 'A', id: 'x', origin: { anything: 1 } }));
		expect(hashTemplate({ name: 'A', prompt: 'p' })).not.toBe(hashTemplate({ name: 'A', prompt: 'q' }));
		expect(hashTemplate({ name: 'A', properties: [{ name: 'n', value: 'v', type: 'text' }] })).toMatch(/^[0-9a-f]{8}$/u);
	});

	it('restores deleted built-ins only', () => {
		const kept = builtIn('flashcards');
		const mine: Template = { id: 'm', name: 'Literature note', prompt: 'mine' };
		const { templates, restored } = restoreBuiltIns([kept, mine], newId);
		expect(templates).toHaveLength(6);
		expect(restored).toEqual(['Comprehensive summary', 'Key points / TL;DR', 'Action items', 'Literature note 1']);
	});

	it('numbers names case-insensitively', () => {
		expect(uniqueName('Summary', ['summary', 'Summary 1'])).toBe('Summary 2');
		expect(uniqueName('New', ['Old'])).toBe('New');
	});
});
