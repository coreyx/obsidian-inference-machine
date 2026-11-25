import { describe, expect, it } from 'vitest';
import type { Template, UiState } from '../../src/core/schema';
import { changedChoiceFields, forgetChoices, hasChoices, pruneChoices, rememberChoice } from '../../src/core/ui-state';

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

describe('changedChoiceFields (Q61)', () => {
	const base: Template = { id: 't1', name: 'One', prompt: 'p', engineId: 'e1', location: { mode: 'folder', path: 'Out' } };

	it('names nothing when neither the engine nor the location changed', () => {
		expect(changedChoiceFields(base, { ...base, name: 'Renamed', location: { mode: 'folder', path: 'Out' } })).toEqual([]);
	});

	it('names each field that changed, including back to inherit', () => {
		expect(changedChoiceFields(base, { ...base, engineId: 'e2' })).toEqual(['engineId']);
		expect(changedChoiceFields(base, { ...base, location: { mode: 'folder', path: 'Tasks' } })).toEqual(['location']);
		const { engineId: _e, location: _l, ...inherit } = base;
		expect(changedChoiceFields(base, inherit)).toEqual(['engineId', 'location']);
	});

	it('names the set fields of a new template', () => {
		expect(changedChoiceFields(undefined, { id: 't9', name: 'New', prompt: 'p' })).toEqual([]);
		expect(changedChoiceFields(undefined, base)).toEqual(['engineId', 'location']);
	});
});
