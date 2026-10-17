import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '../../../src/core/template/knap';

/**
 * 7.1: each first-release filter behaves as Web Clipper's filter of the same
 * name. Web Clipper renders through knap, so parity holds by construction
 * while both use the same knap version. These fixtures pin that version's
 * behavior: if a knap upgrade changes any of them, this test fails and the
 * upgrade gets reviewed against Web Clipper before it ships.
 */

const PINNED_KNAP_VERSION = '0.6.0';

const variables = {
	s: '  Hello World  ',
	list: ['a', 'b', 'c'],
	csv: 'a,b,c',
	d: '2026-03-01T10:20:00',
	n: 'Note',
};

/** [template, expected output] for every filter listed in 7.0.2. */
const FIXTURES: [string, string][] = [
	['{{s|lower}}', '  hello world  '],
	['{{s|upper}}', '  HELLO WORLD  '],
	['{{s|trim}}', 'Hello World'],
	['{{s|replace:"World":"There"}}', '  Hello There  '],
	['{{s|trim|replace:"l":""}}', 'Heo Word'],
	['{{csv|split:","}}', '["a","b","c"]'],
	['{{csv|split:","|join:" + "}}', 'a + b + c'],
	['{{list|join:", "}}', 'a, b, c'],
	['{{list|first}}', 'a'],
	['{{list|last}}', 'c'],
	['{{list|slice:1,2}}', 'b'],
	['{{n|slice:0,2}}', 'No'],
	['{{d|date:"YYYY-MM-DD"}}', '2026-03-01'],
	['{{d|date:"DD MMM YYYY"}}', '01 Mar 2026'],
	['{{n|wikilink}}', '[[Note]]'],
	['{{list|wikilink|join:" "}}', '[[a]] [[b]] [[c]]'],
	['{{list|list}}', '- a\n- b\n- c'],
	['{{list|list:numbered}}', '1. a\n2. b\n3. c'],
	['{{missing|default:"n/a"}}', 'n/a'],
	['{{n|default:"n/a"}}', 'Note'],
];

describe('filter parity with Web Clipper (7.1)', () => {
	it(`runs against knap ${PINNED_KNAP_VERSION}`, () => {
		const installed = (JSON.parse(readFileSync('node_modules/knap/package.json', 'utf8')) as { version: string }).version;
		expect(installed).toBe(PINNED_KNAP_VERSION);
	});

	for (const [template, expected] of FIXTURES) {
		it(template, async () => {
			expect(await render(template, variables)).toEqual({ text: expected, notices: [] });
		});
	}
});
