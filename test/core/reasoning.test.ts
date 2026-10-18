import { describe, expect, it } from 'vitest';
import { outputLimitMessage, stripReasoning } from '../../src/core/reasoning';
import { requestAiTags } from '../../src/core/tagging-request';

describe('stripReasoning (8.0.8)', () => {
	it('removes a reasoning block before the answer (8.8)', () => {
		expect(stripReasoning('<think>planning the summary…\nmore thought</think>\n## Summary\nText')).toBe('## Summary\nText');
	});

	it('removes every block, wherever it is, in any case', () => {
		expect(stripReasoning('A <THINK>x</THINK>B<think>y</think> C')).toBe('A B C');
	});

	it('drops everything before a closing tag with no opening tag', () => {
		expect(stripReasoning('I should list the steps first.\n</think>\n\n## Steps')).toBe('## Steps');
	});

	it('drops a block left open when the output limit cut the model off', () => {
		expect(stripReasoning('<think>still thinking about')).toBe('');
		expect(stripReasoning('Answer so far\n<think>second thoughts')).toBe('Answer so far\n');
	});

	it('leaves responses without reasoning alone', () => {
		expect(stripReasoning('## Summary\nNo tags here.')).toBe('## Summary\nNo tags here.');
		expect(stripReasoning('```markdown\n## A\n```')).toBe('```markdown\n## A\n```');
	});

	it('explains an output limit spent before any answer (8.0.9)', () => {
		expect(outputLimitMessage('LM Studio', 'an answer')).toMatch(/^LM Studio used its whole output limit before writing an answer.*Raise the engine's maximum output tokens/u);
	});
});

describe('AI tagging with reasoning models', () => {
	it('reads tags after the reasoning', async () => {
		const result = await requestAiTags(async () => ({ text: '<think>which tags?</think>{"tags":["engines"]}', truncated: false, streamed: false }), { user: 'x' });
		expect(result).toEqual({ tags: ['engines'] });
	});

	it('says why there are no tags when the output limit ran out', async () => {
		const result = await requestAiTags(async () => ({ text: '<think>which tags are best', truncated: true, streamed: false }), { user: 'x' });
		expect(result.tags).toEqual([]);
		expect(result.notice).toMatch(/whole output limit before suggesting any tags/u);
	});
});
