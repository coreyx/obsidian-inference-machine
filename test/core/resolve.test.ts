import { describe, expect, it } from 'vitest';
import { DEFAULTS, defaultGlobalSettings } from '../../src/core/defaults';
import { resolveRunConfig, type ResolveInput } from '../../src/core/resolve';
import type { EngineConfig, GlobalSettings, Template } from '../../src/core/schema';

const local: EngineConfig = { id: 'local', name: 'Local', provider: 'openai-compatible', model: 'qwen', baseUrl: 'http://localhost:1234/v1' };
const claude: EngineConfig = { id: 'claude', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5-5' };

function input(overrides: Partial<ResolveInput> = {}): ResolveInput {
	return {
		popup: {},
		template: { id: 't', name: 'Summary', prompt: 'Summarize this.' },
		globalSettings: defaultGlobalSettings(),
		engines: [local, claude],
		defaultEngineId: 'local',
		...overrides,
	};
}

describe('resolveRunConfig: engines', () => {
	it('uses the default engine for a template without one (3.2)', () => {
		const { config } = resolveRunConfig(input({ defaultEngineId: 'claude' }));
		expect(config.engine).toBe(claude);
		expect(config.sources.engine).toBe('global');
	});

	it('prefers the template\'s engine over the default', () => {
		const { config } = resolveRunConfig(input({ template: { id: 't', name: 'T', prompt: 'p', engineId: 'claude' } }));
		expect(config.engine).toBe(claude);
		expect(config.sources.engine).toBe('template');
	});

	it('applies a popup override to this run only (3.3)', () => {
		const template: Template = { id: 't', name: 'T', prompt: 'p', engineId: 'local' };
		const globalSettings = defaultGlobalSettings();
		const before = JSON.stringify({ template, globalSettings });
		const { config } = resolveRunConfig(input({ template, globalSettings, popup: { engineId: 'claude' } }));
		expect(config.engine).toBe(claude);
		expect(config.sources.engine).toBe('popup');
		expect(JSON.stringify({ template, globalSettings })).toBe(before);
	});

	it('falls back to the default with a notice when the template\'s engine is gone (3.5)', () => {
		const { config, notices } = resolveRunConfig(
			input({ template: { id: 't', name: 'Weekly review', prompt: 'p', engineId: 'deleted' } }),
		);
		expect(config.engine).toBe(local);
		expect(notices).toEqual([
			'The engine set for template "Weekly review" no longer exists, so the default engine is used instead.',
		]);
	});

	it('ignores a popup choice for an engine that no longer exists', () => {
		const { config } = resolveRunConfig(input({ popup: { engineId: 'deleted' } }));
		expect(config.engine).toBe(local);
	});

	it('uses any engine when none is marked default, and none when there are none', () => {
		expect(resolveRunConfig(input({ defaultEngineId: undefined })).config.engine).toBe(local);
		const empty = resolveRunConfig(input({ engines: [], defaultEngineId: undefined })).config;
		expect(empty.engine).toBeUndefined();
	});
});

describe('resolveRunConfig: layers', () => {
	it('resolves a template with only a name and a prompt fully (5.2)', () => {
		const { config, notices } = resolveRunConfig(input());
		expect(notices).toEqual([]);
		expect(config).toMatchObject({
			location: DEFAULTS.location,
			noteNameFormat: DEFAULTS.noteNameFormat,
			noteContentFormat: DEFAULTS.noteContentFormat,
			context: DEFAULTS.context,
			skipPreview: false,
			references: DEFAULTS.references,
			openAfterCreate: true,
			omitEmptyProperties: false,
			collision: 'number',
			tagging: { ...DEFAULTS.tagging, preferredTags: [] },
		});
		for (const value of Object.values(config)) expect(value).not.toBeUndefined();
	});

	it('applies a global folder unless the template sets its own (5.3)', () => {
		const globalSettings: GlobalSettings = { ...defaultGlobalSettings(), location: { mode: 'folder', path: 'Summaries' } };
		expect(resolveRunConfig(input({ globalSettings })).config.location).toEqual({ mode: 'folder', path: 'Summaries' });

		const template: Template = { id: 't', name: 'T', prompt: 'p', location: { mode: 'folder', path: 'Meetings/Actions' } };
		const { config } = resolveRunConfig(input({ globalSettings, template }));
		expect(config.location).toEqual({ mode: 'folder', path: 'Meetings/Actions' });
		expect(config.sources.location).toBe('template');
	});

	it('takes the popup location over the template\'s', () => {
		const template: Template = { id: 't', name: 'T', prompt: 'p', location: { mode: 'folder', path: 'A' } };
		const { config } = resolveRunConfig(input({ template, popup: { location: { mode: 'alongside' } } }));
		expect(config.location).toEqual({ mode: 'alongside' });
		expect(config.sources.location).toBe('popup');
	});

	it('records each field\'s layer across every combination', () => {
		const cases: { template?: Partial<Template>; globalName?: string; expected: string; layer: string }[] = [
			{ expected: DEFAULTS.noteNameFormat, layer: 'default' },
			{ globalName: '{{date}} {{title}}', expected: '{{date}} {{title}}', layer: 'global' },
			{ template: { noteNameFormat: '{{title}}' }, globalName: '{{date}}', expected: '{{title}}', layer: 'template' },
		];
		for (const c of cases) {
			const globalSettings = { ...defaultGlobalSettings(), ...(c.globalName ? { noteNameFormat: c.globalName } : {}) };
			const template = { id: 't', name: 'T', prompt: 'p', ...c.template };
			const { config } = resolveRunConfig(input({ template, globalSettings }));
			expect(config.noteNameFormat).toBe(c.expected);
			expect(config.sources.noteNameFormat).toBe(c.layer);
		}
	});

	it('treats an explicit false on the template as set, not as inherit', () => {
		const globalSettings = { ...defaultGlobalSettings(), openAfterCreate: true };
		const template: Template = { id: 't', name: 'T', prompt: 'p', openAfterCreate: false, references: { enabled: false } };
		const { config } = resolveRunConfig(input({ template, globalSettings }));
		expect(config.openAfterCreate).toBe(false);
		expect(config.references).toEqual({ enabled: false, heading: '# References' });
		expect(config.sources['references.enabled']).toBe('template');
		expect(config.sources['references.heading']).toBe('global');
	});

	it('carries the source over by default, and lets a template turn either part off', () => {
		const { config } = resolveRunConfig(input());
		expect(config).toMatchObject({ carryImages: true, carryProperties: true, excludedProperties: ['aliases', 'cssclasses'] });
		expect(config.sources).toMatchObject({ carryImages: 'global', carryProperties: 'global', excludedProperties: 'global' });

		const globalSettings = { ...defaultGlobalSettings(), carryImages: false, excludedProperties: ['type'] };
		const template: Template = { id: 't', name: 'T', prompt: 'p', carryImages: true, carryProperties: false };
		const resolved = resolveRunConfig(input({ template, globalSettings })).config;
		expect(resolved).toMatchObject({ carryImages: true, carryProperties: false, excludedProperties: ['type'] });
		expect(resolved.sources).toMatchObject({ carryImages: 'template', carryProperties: 'template' });
		expect(resolved.excludedProperties).not.toBe(globalSettings.excludedProperties);
	});

	it('merges tagging field by field, with preferred tags from the template only', () => {
		const globalSettings = defaultGlobalSettings();
		globalSettings.tagging = { ...globalSettings.tagging, aiTagging: true, format: 'snake', maxTags: 5 };
		const template: Template = {
			id: 't',
			name: 'Flashcards',
			prompt: 'p',
			tagging: { format: { custom: 'Title Case' }, preferredTags: ['flashcards'] },
		};
		const { config } = resolveRunConfig(input({ template, globalSettings }));
		expect(config.tagging).toEqual({
			...DEFAULTS.tagging,
			aiTagging: true,
			format: { custom: 'Title Case' },
			maxTags: 5,
			preferredTags: ['flashcards'],
		});
		expect(config.sources['tagging.format']).toBe('template');
		expect(config.sources['tagging.aiTagging']).toBe('global');
		config.tagging.preferredTags.push('changed');
		expect(template.tagging?.preferredTags).toEqual(['flashcards']);
	});
});
