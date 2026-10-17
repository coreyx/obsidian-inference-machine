import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../src/core/defaults';
import {
	answerMap,
	buildInlineRequest,
	collectTemplatePrompts,
	parseInlineResponse,
	repairJson,
	unansweredNotice,
} from '../../src/core/inline';
import { render } from '../../src/core/template/knap';
import { buildVariables } from '../../src/core/template/variables';
import { alpha } from '../fixtures/notes';

const vars = buildVariables(alpha, { templateName: 'Book reference', now: new Date(2026, 9, 17) });

describe('collectTemplatePrompts', () => {
	it('collects from filename, properties and body, in order, without duplicates', () => {
		expect(
			collectTemplatePrompts({
				noteNameFormat: '{{"a short title"}}',
				propertyValues: ['{{"a one-sentence description"}}', '{{"a short title"|lower}}', 'plain'],
				noteContentFormat: '{{output}}\n\n{{"three key phrases"}}',
			}),
		).toEqual(['a short title', 'a one-sentence description', 'three key phrases']);
	});
});

describe('buildInlineRequest', () => {
	it('puts every prompt in one request, numbered (21.2)', () => {
		const request = buildInlineRequest('Context here', ['one', 'two', 'three']);
		expect(request.system).toContain('"prompts_responses"');
		expect(request.user).toContain('Context here');
		expect(JSON.parse(request.user.slice(request.user.indexOf('{')))).toEqual({
			prompts: { prompt_1: 'one', prompt_2: 'two', prompt_3: 'three' },
		});
	});

	it('sends only the body when the context is {{body}} (21.5)', async () => {
		const { text: context } = await render('{{body}}', vars);
		const request = buildInlineRequest(context, ['x']);
		expect(request.user).toContain('We ship the beta');
		expect(request.user).not.toContain('author: Ada');

		const { text: defaultContext } = await render(DEFAULTS.context, vars);
		expect(buildInlineRequest(defaultContext, ['x']).user).toContain('author: Ada');
	});
});

describe('parseInlineResponse', () => {
	it('reads a well-formed response', () => {
		expect(parseInlineResponse('{"prompts_responses":{"prompt_1":"A","prompt_2":"B"}}', 2)).toEqual(['A', 'B']);
	});

	it('handles the malformed responses models actually send', () => {
		const corpus: [string, (string | undefined)[]][] = [
			// Text before and after the object.
			['Sure! Here you go:\n{"prompts_responses":{"prompt_1":"A"}}\nHope that helps.', ['A']],
			// Fenced JSON.
			['```json\n{"prompts_responses": {"prompt_1": "A", "prompt_2": "B"}}\n```', ['A', 'B']],
			// Literal line breaks inside a string.
			['{"prompts_responses":{"prompt_1":"line one\nline two"}}', ['line one\nline two']],
			// Unescaped quotes inside a string.
			['{"prompts_responses":{"prompt_1":"He said "hi" twice","prompt_2":"ok"}}', ['He said "hi" twice', 'ok']],
			// Curly quotes as delimiters.
			['{\u201Cprompts_responses\u201D:{\u201Cprompt_1\u201D:\u201CA\u201D}}', ['A']],
			// Without the prompts_responses wrapper.
			['{"prompt_1":"A","prompt_2":"B"}', ['A', 'B']],
			// A missing key.
			['{"prompts_responses":{"prompt_2":"B"}}', [undefined, 'B']],
			// Non-string answers.
			['{"prompts_responses":{"prompt_1":["a","b"],"prompt_2":3,"prompt_3":{"k":1},"prompt_4":null}}', ['a, b', '3', '{\n  "k": 1\n}', undefined]],
			// Broken beyond repair: answers are read one by one.
			['{"prompts_responses":{"prompt_1":"A", "prompt_2": "B",, oops', ['A', 'B']],
			// Nothing usable.
			['I cannot help with that.', [undefined]],
		];
		for (const [raw, expected] of corpus) expect(parseInlineResponse(raw, expected.length), raw).toEqual(expected);
	});

	it('keeps an escaped answer that only the per-key reader can find', () => {
		expect(parseInlineResponse('garbage "prompt_1": "tab\\there" more garbage', 1)).toEqual(['tab\there']);
	});
});

describe('repairJson', () => {
	it('escapes control characters and drops carriage returns', () => {
		expect(repairJson('{"a":"x\r\ny\tz\u0001"}')).toBe('{"a":"x\\ny\\tz"}');
		expect(repairJson('{"a":"keep \\" this"}')).toBe('{"a":"keep \\" this"}');
	});
});

describe('answers and notices', () => {
	it('fills a property from its answer (21.1) and empties a missing one (21.6)', async () => {
		const prompts = ['a one-sentence description', 'the publication year'];
		const { answers, unanswered } = answerMap(prompts, parseInlineResponse('{"prompts_responses":{"prompt_1":"A note about Alpha."}}', 2));
		expect((await render('{{"a one-sentence description"}}', vars, answers)).text).toBe('A note about Alpha.');
		expect((await render('[{{"the publication year"}}]', vars, answers)).text).toBe('[]');
		expect(unanswered).toEqual(['the publication year']);
		expect(unansweredNotice(unanswered)).toBe(
			'No answer came back for the inline prompt "the publication year", so it was left empty.',
		);
	});

	it('names several unanswered prompts, shortening long ones', () => {
		const notice = unansweredNotice(['short', 'x'.repeat(80)]);
		expect(notice).toMatch(/^No answer came back for these inline prompts "short", "x{57}\.\.\.", so they were left empty\.$/u);
		expect(unansweredNotice([])).toBeUndefined();
	});
});
