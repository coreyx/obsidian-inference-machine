/**
 * The plugin's persisted data model (design.md, "Data model").
 *
 * Everything here is plain data so it can be stored in `data.json`, exported
 * as template files (REQ-20) and passed through the pure core unchanged.
 * Optional template fields mean "inherit from the global config" (design
 * decision 3); `resolve.ts` turns them into a fully populated run config.
 */

/** Current version of `data.json`. Bump it and add a migration when the shape changes. */
export const SCHEMA_VERSION = 1;

/** Root of `data.json`. */
export interface PluginData {
	/** Version of this structure, used to run settings migrations. */
	schemaVersion: number;
	engines: EngineConfig[];
	/** The engine templates use when they don't name one (3.0.3). */
	defaultEngineId?: string;
	/** The global config. Named so it can't be mistaken for the `global` object. */
	globalSettings: GlobalSettings;
	templates: Template[];
	ui: UiState;
}

/** The four wire formats an engine can speak (3.0.1). */
export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';

/** Every provider type, for validating loaded and imported data. */
export const PROVIDER_TYPES: readonly ProviderType[] = ['anthropic', 'openai', 'gemini', 'openai-compatible'];

/** A saved, named AI engine: provider plus model plus generation settings (3.0.2). */
export interface EngineConfig {
	/** Stable id; templates refer to engines by id, so renaming an engine keeps them linked. */
	id: string;
	name: string;
	provider: ProviderType;
	/** Required for `openai-compatible`; an optional override for the other providers. */
	baseUrl?: string;
	/**
	 * Id of the API key in Obsidian's SecretStorage. The key itself never lives
	 * in plugin data (18.0.4). Optional for `openai-compatible` (3.0.10).
	 */
	secretId?: string;
	model: string;
	temperature?: number;
	maxOutputTokens?: number;
	/** Context window in tokens, used for the long-note warning (3.0.9, REQ-16). */
	contextWindow?: number;
	/** Where `contextWindow` came from, so a reported value can be told apart from a typed one. */
	contextWindowSource?: 'reported' | 'table' | 'user';
	/** Set by LM Studio detection, so detecting again updates this engine instead of adding one (4.4). */
	lmStudio?: { port: number };
}

/** Where the output note goes: a fixed folder, or the source note's folder. */
export type OutputLocation = { mode: 'folder'; path: string } | { mode: 'alongside' };

/**
 * A reusable recipe for deriving a note. Field names follow Web Clipper's
 * template model where the meaning is the same (`noteNameFormat`,
 * `noteContentFormat`, `properties`, `context`), so Web Clipper users
 * recognize them (tech.md, "Lessons from Web Clipper").
 */
export interface Template {
	/** Stable id; the per-template command id is `derive-<id>` (1.4). */
	id: string;
	name: string;
	/** Main prompt. A template has a main prompt, inline prompts, or both (5.0.2). */
	prompt?: string;
	/** Context sent with the inline-prompt request (21.0.3). */
	context?: string;
	/** Filename pattern. */
	noteNameFormat?: string;
	location?: OutputLocation;
	/** Body wrapper; `{{output}}` places the main AI output. */
	noteContentFormat?: string;
	properties?: PropertyDef[];
	/** Leave out properties whose value renders empty (15.0.8, 20.0.8). */
	omitEmptyProperties?: boolean;
	tagging?: TaggingOverrides;
	engineId?: string;
	/** Save straight after the run, without the preview (9.0.4). */
	skipPreview?: boolean;
	references?: { enabled?: boolean; heading?: string };
	openAfterCreate?: boolean;
	/** Present only on built-in templates, so unedited copies can be upgraded (design decision 2). */
	origin?: TemplateOrigin;
}

/** Provenance of a built-in template's copy in user data. */
export interface TemplateOrigin {
	builtInId: string;
	version: number;
	/** Hash of the template's content when it was installed; a mismatch means the user edited it. */
	hash: string;
}

/** Obsidian property types a template property can be written as. */
export type PropertyType = 'text' | 'multitext' | 'number' | 'checkbox' | 'date' | 'datetime';

/** Every property type, for validating loaded and imported data. */
export const PROPERTY_TYPES: readonly PropertyType[] = ['text', 'multitext', 'number', 'checkbox', 'date', 'datetime'];

/** One frontmatter property of the output note. */
export interface PropertyDef {
	name: string;
	/** A knap template, rendered with the run's variables. */
	value: string;
	type: PropertyType;
}

/** A tag format the plugin can convert to, or a custom one described in the user's words (13.0.1). */
export type TagFormat = 'kebab' | 'snake' | 'camel' | 'pascal' | { custom: string };

/** Tagging behavior (REQ-11 to REQ-14). */
export interface TaggingSettings {
	mergeSourceTags: boolean;
	aiTagging: boolean;
	format: TagFormat;
	applyFormatToSource: boolean;
	hierarchicalPrefixes: boolean;
	reuseVaultTags: boolean;
	existingOnly: boolean;
	minTags: number;
	maxTags: number;
}

/** A template's tagging settings: any field left out inherits the global value. */
export interface TaggingOverrides extends Partial<TaggingSettings> {
	/** Tags the AI should favor (14.0.6). Template-only: there's no global list. */
	preferredTags?: string[];
}

/** The global config: the third settings layer, under popup overrides and templates. */
export interface GlobalSettings {
	location: OutputLocation;
	/** Unset means the built-in `{{title}} - {{template}}`. */
	noteNameFormat?: string;
	tagging: TaggingSettings;
	references: { enabled: boolean; heading: string };
	openAfterCreate: boolean;
	/** What to do when the output name is taken (10.0.4). */
	collision: 'number' | 'ask';
	lmStudioPort: number;
}

/** Popup state remembered between runs (19.0.3). */
export interface UiState {
	lastTemplateId?: string;
	lastLocation?: OutputLocation;
}
