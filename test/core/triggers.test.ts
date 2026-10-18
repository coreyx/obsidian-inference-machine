import { describe, expect, it } from 'vitest';
import { checkTemplate } from '../../src/core/data-validation';
import type { Template } from '../../src/core/schema';
import { exportTemplates, importTemplates } from '../../src/core/template-transfer';
import { matchTemplate, parseTriggers, ruleMatches, type TriggerRule } from '../../src/core/triggers';
import { snapshot } from '../fixtures/notes';

const rule = (line: string): TriggerRule => {
	const { triggers, problems } = parseTriggers([line]);
	expect(problems, line).toEqual([]);
	return triggers[0]!.rule;
};
const matches = (line: string, note: ReturnType<typeof snapshot>) => ruleMatches(rule(line), note);

const meeting = snapshot('Meetings/Weekly/2026-10-14 launch sync.md', '---\ntype: Meeting\n---\nNotes from the Recipe review.', { type: 'Meeting', source: '', attendees: ['Ada', 'Grace'], rating: 4 }, {
	frontmatterTags: ['project/beta', 'Meetings'],
	inlineTags: ['todo'],
});

describe('parseTriggers', () => {
	it('reads every rule type, skipping blank lines', () => {
		const { triggers, problems } = parseTriggers(['#Project', '', '  folder: /Meetings/  ', 'property:type=book', 'property:source', 'title:/^\\d{4}/', 'content:/recipe/i']);
		expect(problems).toEqual([]);
		expect(triggers.map((t) => [t.line, t.rule.kind])).toEqual([
			[1, 'tag'],
			[3, 'folder'],
			[4, 'property'],
			[5, 'property'],
			[6, 'title'],
			[7, 'content'],
		]);
		expect(triggers[0]!.rule).toEqual({ kind: 'tag', tag: 'project' });
		expect(triggers[1]!.rule).toEqual({ kind: 'folder', path: 'meetings' });
		expect(triggers[2]!.rule).toEqual({ kind: 'property', key: 'type', value: 'book' });
		expect(triggers[3]!.rule).toEqual({ kind: 'property', key: 'source' });
	});

	it('reports unreadable lines and invalid expressions with their line numbers (22.8)', () => {
		const { triggers, problems } = parseTriggers(['folder:Ok', 'title:/[/', 'colour:blue', 'content:no-slashes', '#', 'folder:', 'property:', '# two words']);
		expect(triggers).toHaveLength(1);
		expect(problems.map((p) => [p.line, p.message.split('.')[0]])).toEqual([
			[2, 'The expression isn\'t valid: Invalid regular expression: /[/: Unterminated character class'],
			[3, 'Unknown trigger "colour:blue"'],
			[4, 'Write the expression between slashes, like /^Meeting/i'],
			[5, '"#" isn\'t a tag'],
			[6, 'Name a folder after folder:, like folder:Meetings'],
			[7, 'Name a property after property:, like property:type=book'],
			[8, '"# two words" isn\'t a tag'],
		]);
	});

	it('drops the g and y flags, which would make matching stateful', () => {
		const r = rule('title:/sync/gi');
		expect(r.kind === 'title' && r.regex.flags).toBe('i');
		expect(matches('title:/sync/g', meeting) && matches('title:/sync/g', meeting)).toBe(true);
	});
});

describe('rules', () => {
	it('match tags, including nested tags, in frontmatter or inline (22.2)', () => {
		expect(matches('#project', meeting)).toBe(true);
		expect(matches('#Project/Beta', meeting)).toBe(true);
		expect(matches('#todo', meeting)).toBe(true);
		expect(matches('#meetings', meeting)).toBe(true);
		const other = snapshot('A.md', 'x', {}, { frontmatterTags: ['projects'] });
		expect(matches('#project', other)).toBe(false);
	});

	it('match folders by whole path segments, ignoring case', () => {
		expect(matches('folder:Meetings', meeting)).toBe(true);
		expect(matches('folder:meetings/weekly', meeting)).toBe(true);
		expect(matches('folder:Meet', meeting)).toBe(false);
		expect(matches('folder:Weekly', meeting)).toBe(false);
	});

	it('match properties by key, and by value ignoring case, including list items (22.3)', () => {
		expect(matches('property:type=meeting', meeting)).toBe(true);
		expect(matches('property:TYPE=Meeting', meeting)).toBe(true);
		expect(matches('property:type=book', meeting)).toBe(false);
		expect(matches('property:source', meeting)).toBe(true);
		expect(matches('property:missing', meeting)).toBe(false);
		expect(matches('property:attendees=grace', meeting)).toBe(true);
		expect(matches('property:rating=4', meeting)).toBe(true);
		const book = snapshot('B.md', 'x', { type: 'Book', published: new Date(Date.UTC(2026, 2, 1)), meta: { a: 1 }, empty: null });
		expect(matches('property:type=book', book)).toBe(true);
		expect(matches('property:published=2026-03-01', book)).toBe(true);
		expect(matches('property:meta={"a":1}', book)).toBe(true);
		expect(matches('property:empty=x', book)).toBe(false);
	});

	it('match title and content expressions (22.4)', () => {
		const daily = snapshot('Daily/2026-10-01.md', 'Ate pancakes.');
		expect(matches('title:/^\\d{4}-\\d{2}-\\d{2}/', daily)).toBe(true);
		expect(matches('title:/^\\d{4}-\\d{2}-\\d{2}/', meeting)).toBe(true);
		expect(matches('title:/^Weekly/', meeting)).toBe(false);
		expect(matches('content:/recipe/i', meeting)).toBe(true);
		expect(matches('content:/recipe/', meeting)).toBe(false);
	});
});

describe('matchTemplate', () => {
	const t = (id: string, triggers?: string[]): Template => ({ id, name: id, prompt: 'p', ...(triggers ? { triggers } : {}) });

	it('chooses the first matching template in list order, and names the trigger (22.5)', () => {
		const summary = t('summary', ['folder:Notes']);
		const actions = t('actions', ['title:/[/', 'folder:Meetings']);
		const digest = t('digest', ['#project']);
		expect(matchTemplate([summary, actions, digest], meeting)).toEqual({ template: actions, trigger: 'folder:Meetings' });
		expect(matchTemplate([digest, actions], meeting)).toEqual({ template: digest, trigger: '#project' });
	});

	it('returns nothing when no template matches', () => {
		expect(matchTemplate([t('a'), t('b', ['folder:Elsewhere'])], meeting)).toBeUndefined();
	});
});

describe('triggers in saved and exported templates (22.10)', () => {
	it('are kept by validation, export and import', () => {
		const template: Template = { id: 'x', name: 'Digest', prompt: 'p', triggers: ['folder:Meetings', '#project'] };
		expect(checkTemplate(template, { requireId: true }).value?.triggers).toEqual(['folder:Meetings', '#project']);
		const imported = importTemplates(exportTemplates([template], []), [], [], () => 'new');
		expect(imported.ok && imported.templates[0]!.triggers).toEqual(['folder:Meetings', '#project']);
	});

	it('reject a triggers value that is not a list of text', () => {
		expect(checkTemplate({ id: 'x', name: 'T', prompt: 'p', triggers: 'folder:A' }, { requireId: true }).problems).toEqual(['Template "T": triggers must be a list of text']);
	});
});
