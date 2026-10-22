import { DEFAULTS } from './defaults';
import type { EngineConfig, GlobalSettings, OutputLocation, TaggingSettings, Template } from './schema';

/**
 * Settings resolution (design decision 3). Each setting comes from the first
 * layer that sets it: a one-off popup override, the template, the global
 * config, then the built-in safe default. The result records which layer
 * supplied each field, so the UI can say where a value came from.
 */

/** The four settings layers, highest precedence first. */
export type SettingsLayer = 'popup' | 'template' | 'global' | 'default';

/** The per-run choices the popup offers (8.0.1). They apply to this run only (3.0.6). */
export interface PopupOverrides {
	engineId?: string;
	location?: OutputLocation;
}

/** Tagging settings for one run, with the template's preferred tags attached. */
export interface ResolvedTagging extends TaggingSettings {
	preferredTags: string[];
}

/** Every setting a run needs, fully populated. */
export interface RunConfig {
	template: Template;
	/** Undefined only when no engine is configured at all (3.0.8). */
	engine: EngineConfig | undefined;
	location: OutputLocation;
	noteNameFormat: string;
	noteContentFormat: string;
	context: string;
	skipPreview: boolean;
	references: { enabled: boolean; heading: string };
	openAfterCreate: boolean;
	/** Put the source's leading images at the top of the output. */
	carryImages: boolean;
	/** Copy the source's properties, minus tags and `excludedProperties`. */
	carryProperties: boolean;
	excludedProperties: string[];
	omitEmptyProperties: boolean;
	collision: 'number' | 'ask';
	tagging: ResolvedTagging;
	/** Which layer supplied each field, keyed by field name (`tagging.aiTagging` for nested ones). */
	sources: Record<string, SettingsLayer>;
}

/** Everything resolution reads. */
export interface ResolveInput {
	popup: PopupOverrides;
	template: Template;
	globalSettings: GlobalSettings;
	engines: EngineConfig[];
	defaultEngineId?: string;
}

/** Picks the first defined value among the layers, and names the layer it came from. */
function pick<T>(layers: [SettingsLayer, T | undefined][], fallback: T): [T, SettingsLayer] {
	for (const [layer, value] of layers) {
		if (value !== undefined) return [value, layer];
	}
	return [fallback, 'default'];
}

/**
 * Resolves the engine: the popup's choice, then the template's, then the
 * global default. A template whose engine was deleted falls back to the
 * default, with a notice naming the problem (3.0.7).
 */
function resolveEngine(input: ResolveInput, notices: string[]): [EngineConfig | undefined, SettingsLayer] {
	const byId = (id: string | undefined) => (id === undefined ? undefined : input.engines.find((e) => e.id === id));

	const fromPopup = byId(input.popup.engineId);
	if (fromPopup) return [fromPopup, 'popup'];

	if (input.template.engineId !== undefined) {
		const fromTemplate = byId(input.template.engineId);
		if (fromTemplate) return [fromTemplate, 'template'];
		notices.push(
			`The engine set for template "${input.template.name}" no longer exists, so the default engine is used instead.`,
		);
	}

	const fromGlobal = byId(input.defaultEngineId);
	if (fromGlobal) return [fromGlobal, 'global'];
	// Engines exist but none is marked default (for example, the default was deleted).
	// Any engine is a better outcome than refusing to run.
	return [input.engines[0], 'default'];
}

/** Builds the fully populated configuration for one run. */
export function resolveRunConfig(input: ResolveInput): { config: RunConfig; notices: string[] } {
	const { popup, template: tpl, globalSettings: global } = input;
	const notices: string[] = [];
	const sources: Record<string, SettingsLayer> = {};

	function field<T>(name: string, layers: [SettingsLayer, T | undefined][], fallback: T): T {
		const [value, layer] = pick(layers, fallback);
		sources[name] = layer;
		return value;
	}

	const [engine, engineLayer] = resolveEngine(input, notices);
	sources.engine = engineLayer;

	const taggingOverrides: Partial<TaggingSettings> | undefined = tpl.tagging;
	function taggingField<K extends keyof TaggingSettings>(key: K): TaggingSettings[K] {
		return field<TaggingSettings[K]>(
			`tagging.${key}`,
			[['template', taggingOverrides?.[key]], ['global', global.tagging[key]]],
			DEFAULTS.tagging[key],
		);
	}
	const tagging: ResolvedTagging = {
		mergeSourceTags: taggingField('mergeSourceTags'),
		aiTagging: taggingField('aiTagging'),
		format: taggingField('format'),
		applyFormatToSource: taggingField('applyFormatToSource'),
		hierarchicalPrefixes: taggingField('hierarchicalPrefixes'),
		reuseVaultTags: taggingField('reuseVaultTags'),
		existingOnly: taggingField('existingOnly'),
		minTags: taggingField('minTags'),
		maxTags: taggingField('maxTags'),
		// Preferred tags are template-only (14.0.6): there's no global list to inherit.
		preferredTags: [...(tpl.tagging?.preferredTags ?? [])],
	};

	const config: RunConfig = {
		template: tpl,
		engine,
		location: field('location', [['popup', popup.location], ['template', tpl.location], ['global', global.location]], DEFAULTS.location),
		noteNameFormat: field('noteNameFormat', [['template', tpl.noteNameFormat], ['global', global.noteNameFormat]], DEFAULTS.noteNameFormat),
		noteContentFormat: field('noteContentFormat', [['template', tpl.noteContentFormat]], DEFAULTS.noteContentFormat),
		context: field('context', [['template', tpl.context]], DEFAULTS.context),
		skipPreview: field('skipPreview', [['template', tpl.skipPreview]], DEFAULTS.skipPreview),
		references: {
			enabled: field(
				'references.enabled',
				[['template', tpl.references?.enabled], ['global', global.references.enabled]],
				DEFAULTS.references.enabled,
			),
			heading: field(
				'references.heading',
				[['template', tpl.references?.heading], ['global', global.references.heading]],
				DEFAULTS.references.heading,
			),
		},
		openAfterCreate: field(
			'openAfterCreate',
			[['template', tpl.openAfterCreate], ['global', global.openAfterCreate]],
			DEFAULTS.openAfterCreate,
		),
		carryImages: field('carryImages', [['template', tpl.carryImages], ['global', global.carryImages]], DEFAULTS.carryImages),
		carryProperties: field(
			'carryProperties',
			[['template', tpl.carryProperties], ['global', global.carryProperties]],
			DEFAULTS.carryProperties,
		),
		excludedProperties: [...field<readonly string[]>('excludedProperties', [['global', global.excludedProperties]], DEFAULTS.excludedProperties)],
		omitEmptyProperties: field('omitEmptyProperties', [['template', tpl.omitEmptyProperties]], DEFAULTS.omitEmptyProperties),
		collision: field('collision', [['global', global.collision]], DEFAULTS.collision),
		tagging,
		sources,
	};
	return { config, notices };
}
