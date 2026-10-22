import type { GlobalSettings, OutputLocation, PluginData, TaggingSettings } from './schema';
import { SCHEMA_VERSION } from './schema';

/**
 * Every setting a run needs, fully populated. Settings resolution fills each
 * field from the popup, the template, the global config, and finally these
 * defaults, so a run never meets an unset value.
 */
export interface RunDefaults {
	location: OutputLocation;
	noteNameFormat: string;
	noteContentFormat: string;
	/** Default prompt context for inline prompts: what the main prompt receives (21.0.3, 5.0.5). */
	context: string;
	skipPreview: boolean;
	references: { enabled: boolean; heading: string };
	openAfterCreate: boolean;
	carryImages: boolean;
	carryProperties: boolean;
	excludedProperties: readonly string[];
	omitEmptyProperties: boolean;
	collision: 'number' | 'ask';
	lmStudioPort: number;
	tagging: TaggingSettings;
}

/**
 * The built-in safe defaults (5.0.4, Q17). None of them needs an inference
 * call: AI tagging is off, and a template without inline prompts sends only
 * its main prompt (21.0.8).
 */
export const DEFAULTS: Readonly<RunDefaults> = deepFreeze({
	location: { mode: 'alongside' },
	noteNameFormat: '{{title}} - {{template}}',
	noteContentFormat: '{{output}}',
	context: '{{title}}\n\n{{content}}',
	skipPreview: false,
	references: { enabled: true, heading: '# References' },
	openAfterCreate: true,
	carryImages: true,
	carryProperties: true,
	// Copied aliases would offer the new note under the source's names in link
	// suggestions, and copied cssclasses would style it like the source (Q47).
	excludedProperties: ['aliases', 'cssclasses'],
	omitEmptyProperties: false,
	collision: 'number',
	lmStudioPort: 1234,
	tagging: {
		mergeSourceTags: true,
		aiTagging: false,
		// Kebab-case is the most common style in Obsidian vaults and matches
		// Obsidian's own examples (product decision on tag formats).
		format: 'kebab',
		applyFormatToSource: false,
		hierarchicalPrefixes: true,
		reuseVaultTags: true,
		existingOnly: false,
		minTags: 3,
		maxTags: 7,
	},
});

/**
 * Freezes an object and everything nested in it, so code that reads a default
 * and then mutates its copy can't change the default for every later run.
 */
function deepFreeze<T extends object>(value: T): T {
	for (const child of Object.values(value)) {
		if (child && typeof child === 'object') deepFreeze(child as object);
	}
	return Object.freeze(value);
}

/** A fresh copy of the global config as a new install starts with it. */
export function defaultGlobalSettings(): GlobalSettings {
	return {
		location: { ...DEFAULTS.location },
		tagging: { ...DEFAULTS.tagging },
		references: { ...DEFAULTS.references },
		openAfterCreate: DEFAULTS.openAfterCreate,
		carryImages: DEFAULTS.carryImages,
		carryProperties: DEFAULTS.carryProperties,
		excludedProperties: [...DEFAULTS.excludedProperties],
		collision: DEFAULTS.collision,
		lmStudioPort: DEFAULTS.lmStudioPort,
	};
}

/** A fresh `data.json` for a new install: no engines and no templates yet. */
export function defaultPluginData(): PluginData {
	return {
		schemaVersion: SCHEMA_VERSION,
		engines: [],
		globalSettings: defaultGlobalSettings(),
		templates: [],
		ui: {},
	};
}
