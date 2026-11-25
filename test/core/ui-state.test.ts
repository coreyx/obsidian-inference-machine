import { describe, expect, it } from 'vitest';
import type { UiState } from '../../src/core/schema';
import { forgetChoices, hasChoices, pruneChoices, rememberChoice } from '../../src/core/ui-state';

describe('rememberChoice (Q52, Q53)', () => {
	it('creates an entry for the template, then updates it', () => {
		const ui: UiState = {};
		rememberChoice(ui, 't1', 'engineId', 'e1');
		expect(ui).toEqual({ templateChoices: { t1: { engineId: 'e1' } } });
		rememberChoice(ui, 't1', 'location', { mode: 'folder', path: 'Out' });
		rememberChoice(ui, 't1', 'engineId', 'e2');
		expect(ui.templateChoices).toEqual({ t1: { engineId: 'e2', location: { mode: 'folder', path: 'Out' } } });
	});

	it('keeps other templates\' choices apart', () => {
		const ui: UiState = {};
		rememberChoice(ui, 't1', 'engineId', 'e1');
		rememberChoice(ui, 't2', 'engineId', 'e2');
		expect(ui.templateChoices).toEqual({ t1: { engineId: 'e1' }, t2: { engineId: 'e2' } });
	});
});

describe('forgetChoices (Q61, Q62)', () => {
	it('removes one field and keeps the other', () => {
		const ui: UiState = { templateChoices: { t1: { engineId: 'e1', location: { mode: 'alongside' } } } };
		forgetChoices(ui, 't1', ['engineId']);
		expect(ui.templateChoices).toEqual({ t1: { location: { mode: 'alongside' } } });
	});

	it('removes an emptied entry, and an emptied map', () => {
		const ui: UiState = { lastTemplateId: 't1', templateChoices: { t1: { engineId: 'e1' }, t2: { engineId: 'e2' } } };
		forgetChoices(ui, 't1', ['engineId', 'location']);
		expect(ui.templateChoices).toEqual({ t2: { engineId: 'e2' } });
		forgetChoices(ui, 't2', ['engineId']);
		expect(ui).toEqual({ lastTemplateId: 't1' });
	});

	it('does nothing for a template with nothing remembered', () => {
		const ui: UiState = {};
		forgetChoices(ui, 't1', ['engineId']);
		expect(ui).toEqual({});
	});
});

describe('hasChoices', () => {
	it('is true only when an engine or location is remembered', () => {
		const ui: UiState = { templateChoices: { t1: { engineId: 'e1' }, t2: {} } };
		expect(hasChoices(ui, 't1')).toBe(true);
		expect(hasChoices(ui, 't2')).toBe(false);
		expect(hasChoices(ui, 't3')).toBe(false);
		expect(hasChoices(ui, undefined)).toBe(false);
	});
});

describe('pruneChoices', () => {
	it('forgets deleted templates, deleted engines and a deleted last template', () => {
		const ui: UiState = {
			lastTemplateId: 'gone',
			templateChoices: {
				gone: { engineId: 'e1' },
				t1: { engineId: 'deleted-engine', location: { mode: 'alongside' } },
				t2: { engineId: 'e1' },
			},
		};
		pruneChoices(ui, ['t1', 't2'], ['e1']);
		expect(ui).toEqual({ templateChoices: { t1: { location: { mode: 'alongside' } }, t2: { engineId: 'e1' } } });
	});

	it('keeps everything that still exists', () => {
		const ui: UiState = { lastTemplateId: 't1', templateChoices: { t1: { engineId: 'e1' } } };
		pruneChoices(ui, ['t1'], ['e1']);
		expect(ui).toEqual({ lastTemplateId: 't1', templateChoices: { t1: { engineId: 'e1' } } });
	});
});
