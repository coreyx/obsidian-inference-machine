import { describe, expect, it } from 'vitest';
import { subfolderSegments } from '../../src/core/location';

describe('subfolderSegments (Q58, Q59)', () => {
	it('splits a nested path', () => {
		expect(subfolderSegments('AI/Summaries')).toEqual({ segments: ['AI', 'Summaries'] });
	});

	it('ignores leading and trailing slashes, spaces and "."', () => {
		expect(subfolderSegments('/AI/')).toEqual({ segments: ['AI'] });
		expect(subfolderSegments(' AI ')).toEqual({ segments: ['AI'] });
		expect(subfolderSegments('./AI')).toEqual({ segments: ['AI'] });
		expect(subfolderSegments('AI//Summaries')).toEqual({ segments: ['AI', 'Summaries'] });
	});

	it('accepts backslashes as separators', () => {
		expect(subfolderSegments('AI\\Summaries')).toEqual({ segments: ['AI', 'Summaries'] });
	});

	it('gives no segments for an empty path, meaning the source note\'s folder', () => {
		expect(subfolderSegments('')).toEqual({ segments: [] });
		expect(subfolderSegments('  ')).toEqual({ segments: [] });
	});

	it('refuses a path that leads out of the source note\'s folder', () => {
		const error = { error: 'The folder "../Elsewhere" leads out of the source note\'s folder.' };
		expect(subfolderSegments('../Elsewhere')).toEqual(error);
		expect(subfolderSegments('AI/../..')).toHaveProperty('error');
		expect(subfolderSegments('..')).toHaveProperty('error');
		expect(subfolderSegments('AI\\..')).toHaveProperty('error');
	});

	it('keeps names that only contain dots', () => {
		expect(subfolderSegments('v1..2')).toEqual({ segments: ['v1..2'] });
	});
});
