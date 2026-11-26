import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../../src/core/defaults';
import { collectPrompts, diagnose, findPrompts, referencedVariables, render, usesSelection } from '../../../src/core/template/knap';
import { buildMainPrompt } from '../../../src/core/template/prompt';
import { buildVariables, knownVariables } from '../../../src/core/template/variables';
import { withSelection } from '../../../src/core/note';
import { alpha } from '../../fixtures/notes';

const now = new Date(2026, 9, 17, 8, 4, 0);
const vars = buildVariables(alpha, { templateName: 'Summary', now, output: 'AI OUTPUT' });

async function text(template: string, prompts?: Map<string, string>) {
	return (await render(template, vars, prompts)).text;
}

describe('variables (REQ-6)', () => {
	it('provides each variable in design.md\'s table', async () => {
		expect(await text('{{title}}|{{path}}|{{folder}}|{{template}}')).toBe('Alpha|Projects/Alpha.md|Projects|Summary');
		expect(await text('{{date}} {{time}}')).toBe('2026-10-17 08:04');
		expect(await text('{{created}} / {{modified}}')).toBe('2026-10-01T09:30:00 / 2026-10-02T14:05:07');
		expect(await text('{{frontmatter}}')).toBe('author: Ada\nstatus: active');
		expect(await text('{{output}}')).toBe('AI OUTPUT');
	});

	it('reads frontmatter keys, including keys with spaces (6.1)', async () => {
		expect(await text('{{properties.author}}')).toBe('Ada');
		expect(await text('{{properties["key with spaces"]}}')).toBe('spaced');
	});

	it('includes frontmatter in content but not in body (6.2)', async () => {
		expect(await text('{{content}}')).toContain('author: Ada');
		expect(await text('{{body}}')).not.toContain('author: Ada');
		expect(await text('{{body}}')).toContain('We ship the beta');
	});

	it('renders a missing key as empty without failing (6.3)', async () => {
		const result = await render('[{{properties.missing}}]', vars);
		expect(result).toEqual({ text: '[]', notices: [] });
	});

	it('leaves {{output}} out of prompt rendering', () => {
		expect(buildVariables(alpha, { templateName: 'T', now })).not.toHaveProperty('output');
		expect(knownVariables('prompt').has('output')).toBe(false);
		expect(knownVariables('output').has('output')).toBe(true);
	});

	it('copies properties so rendering can\'t change the snapshot', () => {
		(vars.properties as Record<string, unknown>).author = 'changed';
		expect(alpha.properties.author).toBe('Ada');
		(vars.properties as Record<string, unknown>).author = 'Ada';
	});
});

describe('filters (REQ-7)', () => {
	it('falls back with default (7.2)', async () => {
		expect(await text('{{properties.missing_key|default:"n/a"}}')).toBe('n/a');
		expect(await text('{{properties.author|default:"n/a"}}')).toBe('Ada');
		expect(await text('{{missing|default}}')).toBe('');
	});

	it('applies chained filters left to right (7.3)', async () => {
		expect(await text('{{title|upper|replace:"A":"o"}}')).toBe('oLPHo');
		expect(await text('{{title|replace:"A":"o"|upper}}')).toBe('OLPHA');
	});

	it('leaves the value unfiltered and names an unknown filter (7.4)', async () => {
		const result = await render('{{title|shout}}', vars);
		expect(result.text).toBe('Alpha');
		expect(result.notices).toEqual(['Unknown filter "shout". Did you mean "sort"? The value was left unfiltered.']);
	});

	it('leaves the value unfiltered when a filter\'s arguments are invalid (7.0.3)', async () => {
		const result = await render('{{title|replace:x}}', vars);
		expect(result.text).toBe('Alpha');
		expect(result.notices).toHaveLength(1);
		expect(result.notices[0]).toMatch(/^The "replace" filter has invalid settings \(.+\), so the value was left unfiltered\.$/u);
	});

	it('reports a filter warning, such as a value that isn\'t a date', async () => {
		const result = await render('{{title|date:"YYYY"}}', vars);
		expect(result.text).toBe('Alpha');
		expect(result.notices[0]).toMatch(/^The "date" filter: /u);
	});

	it('uses a template with a syntax error as written, with a notice', async () => {
		const result = await render('{{title', vars);
		expect(result.text).toBe('{{title');
		expect(result.notices[0]).toMatch(/syntax error \(line 1/u);
	});
});

describe('inline prompt variables', () => {
	it('finds prompts with filters, escapes and the legacy form', () => {
		expect(findPrompts('a {{"one"|lower}} b {{ "two" }} {{prompt:"three"}} {{"say \\"hi\\""}}').map((p) => [p.text, p.filters])).toEqual([
			['one', '|lower'],
			['two', ''],
			['three', ''],
			['say "hi"', ''],
		]);
	});

	it('collects distinct prompts in order across fields', () => {
		expect(collectPrompts(['{{"a"}} {{"b"}}', '{{"a"|upper}} {{"c"}}'])).toEqual(['a', 'b', 'c']);
	});

	it('places answers and applies their filters (21.0.4)', async () => {
		const answers = new Map([['three key phrases', 'Alpha, BETA, Gamma']]);
		expect(await text('{{"three key phrases"|lower}}', answers)).toBe('alpha, beta, gamma');
		expect(await text('{{"three key phrases"}} / {{"three key phrases"|upper}}', answers)).toBe(
			'Alpha, BETA, Gamma / ALPHA, BETA, GAMMA',
		);
	});

	it('renders an unanswered prompt as empty', async () => {
		expect(await text('[{{"unanswered"}}]', new Map())).toBe('[]');
	});

	it('renders a prompt as plain text when no answers apply (21.0.7)', async () => {
		expect(await text('Please {{"summarize"}} it')).toBe('Please summarize it');
	});
});

describe('diagnose', () => {
	it('flags a misspelled variable (6.4)', () => {
		expect(diagnose('{{titel}} by {{properties.author}}', 'output')).toEqual([
			{ message: 'Unknown variable "titel". It will be empty when the template runs.', line: 1, column: 3, severity: 'warning' },
		]);
	});

	it('flags {{output}} outside the output fields', () => {
		expect(diagnose('{{output}}', 'prompt')[0]?.message).toMatch(/only available in the filename/u);
		expect(diagnose('{{output}}', 'output')).toEqual([]);
	});

	it('flags an inline prompt in the main prompt or context (21.7)', () => {
		const [problem] = diagnose('Line one\nthen {{"summarize"}}', 'prompt');
		expect(problem).toMatchObject({ line: 2, column: 6, severity: 'error' });
		expect(diagnose('{{"x"}}', 'context')[0]?.message).toMatch(/prompt context/u);
		expect(diagnose('{{"x"}}', 'output')).toEqual([]);
	});

	it('flags unknown filters, bad arguments and syntax errors (7.0.3)', () => {
		expect(diagnose('{{title|shout}}', 'output')).toMatchObject([{ severity: 'error', message: expect.stringMatching(/^Unknown filter "shout"/u) }]);
		expect(diagnose('{{title|default}}', 'output')[0]?.message).toMatch(/fallback value/u);
		expect(diagnose('{{title', 'output')[0]?.message).toBe('Missing closing }}');
	});

	it('knows loop and set variables', () => {
		expect(diagnose('{% for t in properties.tags %}{{t}}{% endfor %}{% set x = title %}{{x}}', 'output')).toEqual([]);
		expect(
			diagnose('{% if properties.a %}{{nope}}{% elseif !title %}{{(path)}}{% else %}{{folder}}{% endif %}', 'output'),
		).toMatchObject([{ message: expect.stringContaining('"nope"') }]);
		expect(diagnose('{{properties[title]|default:body}}', 'output')).toEqual([]);
	});
});

describe('buildMainPrompt (5.0.5)', () => {
	it('appends the filename and full contents when the prompt doesn\'t place them (5.4)', () => {
		expect(buildMainPrompt('Summarize this.', 'Summarize this.', alpha)).toBe(`Summarize this.\n\nFilename: Alpha.md\n\n${alpha.content}`);
	});

	it('leaves prompts that use {{content}} or {{body}} alone', () => {
		expect(buildMainPrompt('Summarize: {{content}}', 'Summarize: X', alpha)).toBe('Summarize: X');
		expect(buildMainPrompt('{{body|trim}}', 'X', alpha)).toBe('X');
		expect(referencedVariables('{{title}} {{properties.a}}')).toEqual(new Set(['title', 'properties']));
	});
});

describe('default filename (5.5)', () => {
	it('is "Alpha - Summary" for Projects/Alpha.md and template "Summary"', async () => {
		expect(await text(DEFAULTS.noteNameFormat)).toBe('Alpha - Summary');
	});
});

describe('selection runs (Q56, Q64)', () => {
	const selected = withSelection(alpha, 'We ship the beta next week.');

	it('puts the selection in {{content}}, {{body}} and {{selection}}, and keeps the rest of the note', async () => {
		const v = buildVariables(selected, { templateName: 'Summary', now });
		const out = (await render('{{content}}|{{body}}|{{selection}}|{{title}}|{{path}}|{{properties.author}}|{{frontmatter}}', v)).text;
		expect(out).toBe('We ship the beta next week.|We ship the beta next week.|We ship the beta next week.|Alpha|Projects/Alpha.md|Ada|author: Ada\nstatus: active');
	});

	it('keeps the whole note in {{content}} and {{body}} for a template that uses {{selection}} (Q64 A)', async () => {
		const v = buildVariables(selected, { templateName: 'Summary', now, wholeNote: true });
		expect((await render('{{content}}', v)).text).toBe(alpha.content);
		expect((await render('{{body}}', v)).text).toBe(alpha.body);
		expect((await render('{{selection}}', v)).text).toBe('We ship the beta next week.');
	});

	it('leaves {{selection}} empty in a whole-note run, and ignores wholeNote there', async () => {
		const v = buildVariables(alpha, { templateName: 'Summary', now, wholeNote: true });
		expect((await render('[{{selection}}]', v)).text).toBe('[]');
		expect((await render('{{content}}', v)).text).toBe(alpha.content);
	});

	it('knows {{selection}} in every field', () => {
		for (const field of ['prompt', 'context', 'output'] as const) expect(knownVariables(field).has('selection')).toBe(true);
		expect(diagnose('Explain {{selection}}', 'prompt')).toEqual([]);
	});

	it('spots {{selection}} in any field, through filters and logic', () => {
		expect(usesSelection(['Summarize this.', '{{selection|upper}}'])).toBe(true);
		expect(usesSelection(['{% if selection %}x{% endif %}'])).toBe(true);
		expect(usesSelection(['{{content}}', '{{title}} - {{template}}', ''])).toBe(false);
	});

	it('adds the filename, frontmatter and labeled selection to a prompt that doesn\'t place the text', () => {
		expect(buildMainPrompt('Summarize this.', 'Summarize this.', selected)).toBe(
			'Summarize this.\n\nFilename: Alpha.md\n\nFrontmatter:\n---\nauthor: Ada\nstatus: active\n---\n\nSelected text:\n\nWe ship the beta next week.',
		);
		const bare = withSelection({ ...alpha, frontmatterText: '' }, 'Just this.');
		expect(buildMainPrompt('Summarize this.', 'Summarize this.', bare)).toBe('Summarize this.\n\nFilename: Alpha.md\n\nSelected text:\n\nJust this.');
	});

	it('adds nothing to a prompt that places the text itself', () => {
		expect(buildMainPrompt('Explain {{selection}}', 'Explain X', selected)).toBe('Explain X');
		expect(buildMainPrompt('Summarize {{content}}', 'Summarize X', selected)).toBe('Summarize X');
		// In a whole-note run, {{selection}} is empty, so the note is still added.
		expect(buildMainPrompt('Explain {{selection}}', 'Explain ', alpha)).toBe(`Explain\n\nFilename: Alpha.md\n\n${alpha.content}`);
	});
});
