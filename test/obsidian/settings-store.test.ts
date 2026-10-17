import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, defaultPluginData } from '../../src/core/defaults';
import { SCHEMA_VERSION } from '../../src/core/schema';
import { normalizePluginData, SettingsStore, type Migration } from '../../src/obsidian/settings-store';

function host(stored: unknown) {
	return {
		loadData: vi.fn(async () => structuredClone(stored)),
		saveData: vi.fn(async (_data: unknown) => {}),
	};
}

describe('DEFAULTS (5.0.4, Q17)', () => {
	it('are the built-in safe defaults', () => {
		expect(DEFAULTS.location).toEqual({ mode: 'alongside' });
		expect(DEFAULTS.noteNameFormat).toBe('{{title}} - {{template}}');
		expect(DEFAULTS.noteContentFormat).toBe('{{output}}');
		expect(DEFAULTS.skipPreview).toBe(false);
		expect(DEFAULTS.references).toEqual({ enabled: true, heading: '# References' });
		expect(DEFAULTS.openAfterCreate).toBe(true);
		expect(DEFAULTS.collision).toBe('number');
		expect(DEFAULTS.lmStudioPort).toBe(1234);
		expect(DEFAULTS.tagging).toEqual({
			mergeSourceTags: true,
			aiTagging: false,
			format: 'kebab',
			applyFormatToSource: false,
			hierarchicalPrefixes: true,
			reuseVaultTags: true,
			existingOnly: false,
			minTags: 3,
			maxTags: 7,
		});
	});

	it('cannot be mutated, even in nested objects', () => {
		expect(() => {
			(DEFAULTS.tagging as { maxTags: number }).maxTags = 99;
		}).toThrow();
		expect(DEFAULTS.tagging.maxTags).toBe(7);
	});
});

describe('normalizePluginData', () => {
	it('turns an empty data file into the defaults', () => {
		for (const raw of [null, undefined, {}, 'garbage']) {
			const result = normalizePluginData(raw);
			expect(result.data).toEqual(defaultPluginData());
			expect(result.changed).toBe(true);
			expect(result.warnings).toEqual([]);
		}
	});

	it('keeps the user\'s values and fills only what is missing', () => {
		const raw = {
			schemaVersion: SCHEMA_VERSION,
			engines: [{ id: 'e1', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5-5', secretId: 'anthropic-key' }],
			defaultEngineId: 'e1',
			globalSettings: { location: { mode: 'folder', path: 'Summaries' }, tagging: { aiTagging: true, format: 'snake' } },
			templates: [{ id: 't1', name: 'Summary', prompt: 'Summarize this.' }],
			ui: { lastTemplateId: 't1' },
		};
		const { data, warnings } = normalizePluginData(raw);
		expect(warnings).toEqual([]);
		expect(data.engines).toEqual(raw.engines);
		expect(data.defaultEngineId).toBe('e1');
		expect(data.globalSettings.location).toEqual({ mode: 'folder', path: 'Summaries' });
		expect(data.globalSettings.tagging).toEqual({ ...DEFAULTS.tagging, aiTagging: true, format: 'snake' });
		expect(data.globalSettings.references).toEqual(DEFAULTS.references);
		expect(data.templates).toEqual(raw.templates);
		expect(data.ui).toEqual({ lastTemplateId: 't1' });
	});

	it('rejects engines with an unknown provider type, and says so', () => {
		const { data, warnings } = normalizePluginData({
			schemaVersion: SCHEMA_VERSION,
			engines: [
				{ id: 'e1', name: 'Mystery', provider: 'cohere', model: 'x' },
				{ id: 'e2', name: 'Local', provider: 'openai-compatible', model: 'qwen', baseUrl: 'http://localhost:1234/v1' },
			],
			defaultEngineId: 'e1',
		});
		expect(data.engines.map((e) => e.id)).toEqual(['e2']);
		expect(data.defaultEngineId).toBeUndefined();
		expect(warnings).toEqual(['Engine "Mystery" has an unknown provider type "cohere", so it was removed.']);
	});

	it('keeps a template with a bad optional field, resetting just that field', () => {
		const { data, warnings } = normalizePluginData({
			schemaVersion: SCHEMA_VERSION,
			templates: [
				{ id: 't1', name: 'Summary', prompt: 42, skipPreview: true },
				{ name: 'No id' },
			],
		});
		expect(data.templates).toEqual([{ id: 't1', name: 'Summary', skipPreview: true }]);
		expect(warnings).toEqual([
			'Template "Summary": "prompt" must be text; that setting was reset.',
			'Template "No id" has no id, so it was removed.',
		]);
	});

	it('resets invalid global settings to the defaults', () => {
		const { data, warnings } = normalizePluginData({
			schemaVersion: SCHEMA_VERSION,
			globalSettings: { location: { mode: 'nowhere' }, collision: 'explode', lmStudioPort: 99999, tagging: { maxTags: -1 } },
		});
		expect(data.globalSettings.location).toEqual(DEFAULTS.location);
		expect(data.globalSettings.collision).toBe('number');
		expect(data.globalSettings.lmStudioPort).toBe(1234);
		expect(data.globalSettings.tagging.maxTags).toBe(7);
		expect(warnings).toHaveLength(2);
	});

	it('runs each pending migration once, in order', () => {
		const calls: number[] = [];
		const migrations: Record<number, Migration> = {
			0: (raw) => {
				calls.push(0);
				return { ...raw, engines: [{ id: 'e', name: 'Old', provider: 'openai', model: String(raw.model) }] };
			},
			1: (raw) => {
				calls.push(1);
				return { ...raw, defaultEngineId: 'e' };
			},
		};
		const { data } = normalizePluginData({ model: 'gpt-old' }, migrations, 2);
		expect(calls).toEqual([0, 1]);
		expect(data.schemaVersion).toBe(2);
		expect(data.engines[0]?.model).toBe('gpt-old');
		expect(data.defaultEngineId).toBe('e');

		// Saved data is at the current version, so loading it again migrates nothing.
		calls.length = 0;
		normalizePluginData(data, migrations, 2);
		expect(calls).toEqual([]);
	});

	it('loads data from a newer version without claiming to have migrated it', () => {
		const result = normalizePluginData({ schemaVersion: SCHEMA_VERSION + 1 });
		expect(result.fromNewerVersion).toBe(true);
		expect(result.data.schemaVersion).toBe(SCHEMA_VERSION + 1);
		expect(result.warnings[0]).toMatch(/newer version/);
	});
});

describe('SettingsStore', () => {
	it('saves defaults on first load', async () => {
		const h = host(null);
		const store = new SettingsStore(h);
		await store.load();
		expect(store.data).toEqual(defaultPluginData());
		expect(h.saveData).toHaveBeenCalledTimes(1);
	});

	it('does not rewrite data that is already normalized', async () => {
		const h = host(defaultPluginData());
		await new SettingsStore(h).load();
		expect(h.saveData).not.toHaveBeenCalled();
	});

	it('saves after an update', async () => {
		const h = host(defaultPluginData());
		const store = new SettingsStore(h);
		await store.load();
		await store.update((d) => {
			d.globalSettings.openAfterCreate = false;
		});
		expect(h.saveData).toHaveBeenCalledWith(expect.objectContaining({ globalSettings: expect.objectContaining({ openAfterCreate: false }) }));
	});

	it('never saves over data from a newer version', async () => {
		const h = host({ schemaVersion: SCHEMA_VERSION + 1 });
		const store = new SettingsStore(h);
		const warnings = await store.load();
		await store.save();
		expect(warnings).toHaveLength(1);
		expect(h.saveData).not.toHaveBeenCalled();
	});
});
