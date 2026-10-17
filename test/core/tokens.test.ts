import { describe, expect, it } from 'vitest';
import { checkFits, estimateTokens } from '../../src/core/tokens';

describe('estimateTokens', () => {
	it('is ceil(characters / 3.5)', () => {
		expect(estimateTokens('')).toBe(0);
		expect(estimateTokens('abc')).toBe(1);
		expect(estimateTokens('a'.repeat(35))).toBe(10);
		expect(estimateTokens('a'.repeat(36))).toBe(11);
	});
});

describe('checkFits (16.1)', () => {
	// 1,000 tokens of room: a 1,500-token window minus 500 for the reply.
	const window = 1500;
	const maxOutput = 500;

	it('fits at and just under the limit', () => {
		expect(checkFits('a'.repeat(3500), window, maxOutput)).toEqual({ status: 'fits', estimate: 1000, limit: 1000 });
		expect(checkFits('a'.repeat(3496), window, maxOutput)).toEqual({ status: 'fits', estimate: 999, limit: 1000 });
	});

	it('is over just over the limit', () => {
		expect(checkFits('a'.repeat(3501), window, maxOutput)).toEqual({ status: 'over', estimate: 1001, limit: 1000 });
	});

	it('uses the whole window when no output limit is set', () => {
		expect(checkFits('a'.repeat(3500), 1000, undefined)).toMatchObject({ status: 'fits', limit: 1000 });
	});

	it('cannot warn without a context window (16.0.4)', () => {
		expect(checkFits('a'.repeat(1_000_000), undefined, 500)).toEqual({ status: 'unknown', estimate: 285715 });
		expect(checkFits('x', 0, undefined).status).toBe('unknown');
	});

	it('never reports a negative limit', () => {
		expect(checkFits('x', 100, 500)).toEqual({ status: 'over', estimate: 1, limit: 0 });
	});
});
