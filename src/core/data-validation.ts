import { DEFAULTS } from './defaults';
import type {
	EngineConfig,
	GlobalSettings,
	OutputLocation,
	PropertyDef,
	TagFormat,
	TaggingOverrides,
	TaggingSettings,
	Template,
	UiState,
} from './schema';
import { PROPERTY_TYPES, PROVIDER_TYPES } from './schema';

/**
 * Shape checks for data the plugin didn't just create itself: `data.json`
 * (which a user or sync conflict may have edited) and imported template files
 * (REQ-20). Each checker returns the valid part of its input plus a list of
 * plain-language problems, so loading can keep what's usable while import can
 * reject a file that has any problem at all (20.0.5).
 */

/** The valid part of a checked value, and what was wrong with the rest. */
export interface Checked<T> {
	value: T | undefined;
	problems: string[];
}

/** True for a plain object (not an array or null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Validates an output location; anything malformed is reported and dropped. */
export function checkLocation(raw: unknown, label: string): Checked<OutputLocation> {
	if (raw === undefined) return { value: undefined, problems: [] };
	if (isRecord(raw) && raw.mode === 'alongside') return { value: { mode: 'alongside' }, problems: [] };
	if (isRecord(raw) && raw.mode === 'folder' && typeof raw.path === 'string') {
		return { value: { mode: 'folder', path: raw.path }, problems: [] };
	}
	return { value: undefined, problems: [`${label}: output location isn't valid`] };
}

/** Validates a tag format: a named format, or `{ custom: "<description>" }`. */
export function checkTagFormat(raw: unknown): TagFormat | undefined {
	if (raw === 'kebab' || raw === 'snake' || raw === 'camel' || raw === 'pascal') return raw;
	if (isRecord(raw) && isNonEmptyString(raw.custom)) return { custom: raw.custom };
	return undefined;
}

const BOOLEAN_TAGGING_KEYS = [
	'mergeSourceTags',
	'aiTagging',
	'applyFormatToSource',
	'hierarchicalPrefixes',
	'reuseVaultTags',
	'existingOnly',
] as const;

/**
 * Validates a template's tagging overrides. Every field is optional, since an
 * absent field inherits the global value.
 */
export function checkTaggingOverrides(raw: unknown, label: string): Checked<TaggingOverrides> {
	if (raw === undefined) return { value: undefined, problems: [] };
	if (!isRecord(raw)) return { value: undefined, problems: [`${label}: tagging settings aren't an object`] };
	const value: TaggingOverrides = {};
	const problems: string[] = [];
	for (const key of BOOLEAN_TAGGING_KEYS) {
		if (raw[key] === undefined) continue;
		if (typeof raw[key] === 'boolean') value[key] = raw[key];
		else problems.push(`${label}: tagging "${key}" must be true or false`);
	}
	if (raw.format !== undefined) {
		const format = checkTagFormat(raw.format);
		if (format) value.format = format;
		else problems.push(`${label}: tag format isn't valid`);
	}
	for (const key of ['minTags', 'maxTags'] as const) {
		if (raw[key] === undefined) continue;
		if (isPositiveInteger(raw[key])) value[key] = raw[key];
		else problems.push(`${label}: "${key}" must be a whole number above 0`);
	}
	if (raw.preferredTags !== undefined) {
		if (Array.isArray(raw.preferredTags) && raw.preferredTags.every((t) => typeof t === 'string')) {
			value.preferredTags = [...(raw.preferredTags)];
		} else {
			problems.push(`${label}: preferred tags must be a list of text`);
		}
	}
	return { value, problems };
}

/** Validates a full tagging settings block, filling anything missing or invalid from `fallback`. */
export function fillTagging(raw: unknown, fallback: TaggingSettings): Checked<TaggingSettings> {
	const overrides = checkTaggingOverrides(isRecord(raw) ? raw : undefined, 'Global settings');
	const merged: TaggingSettings = { ...fallback, format: fallback.format };
	const value = overrides.value ?? {};
	for (const key of BOOLEAN_TAGGING_KEYS) {
		if (value[key] !== undefined) merged[key] = value[key];
	}
	if (value.format !== undefined) merged.format = value.format;
	if (value.minTags !== undefined) merged.minTags = value.minTags;
	if (value.maxTags !== undefined) merged.maxTags = value.maxTags;
	return { value: merged, problems: overrides.problems };
}

/** Validates one saved engine. An engine without an id, name, known provider or model is unusable. */
export function checkEngine(raw: unknown): Checked<EngineConfig> {
	if (!isRecord(raw)) return { value: undefined, problems: ['An engine entry isn\'t an object'] };
	const label = isNonEmptyString(raw.name) ? `Engine "${raw.name}"` : 'An engine';
	const problems: string[] = [];
	if (!isNonEmptyString(raw.id)) problems.push(`${label} has no id`);
	if (!isNonEmptyString(raw.name)) problems.push(`${label} has no name`);
	if (!PROVIDER_TYPES.includes(raw.provider as never)) {
		problems.push(`${label} has an unknown provider type "${String(raw.provider)}"`);
	}
	if (typeof raw.model !== 'string') problems.push(`${label} has no model`);
	if (problems.length > 0) return { value: undefined, problems };

	const engine: EngineConfig = {
		id: raw.id as string,
		name: raw.name as string,
		provider: raw.provider as EngineConfig['provider'],
		model: raw.model as string,
	};
	if (typeof raw.baseUrl === 'string') engine.baseUrl = raw.baseUrl;
	if (typeof raw.secretId === 'string') engine.secretId = raw.secretId;
	if (typeof raw.temperature === 'number') engine.temperature = raw.temperature;
	if (isPositiveInteger(raw.maxOutputTokens)) engine.maxOutputTokens = raw.maxOutputTokens;
	if (isPositiveInteger(raw.contextWindow)) engine.contextWindow = raw.contextWindow;
	if (raw.contextWindowSource === 'reported' || raw.contextWindowSource === 'table' || raw.contextWindowSource === 'user') {
		engine.contextWindowSource = raw.contextWindowSource;
	}
	if (isRecord(raw.lmStudio) && isPositiveInteger(raw.lmStudio.port)) {
		engine.lmStudio = { port: raw.lmStudio.port };
		if (raw.lmStudio.loadContext === true) engine.lmStudio.loadContext = true;
	}
	return { value: engine, problems: [] };
}

function checkProperties(raw: unknown, label: string): Checked<PropertyDef[]> {
	if (raw === undefined) return { value: undefined, problems: [] };
	if (!Array.isArray(raw)) return { value: undefined, problems: [`${label}: properties must be a list`] };
	const value: PropertyDef[] = [];
	const problems: string[] = [];
	for (const item of raw) {
		if (
			isRecord(item) &&
			isNonEmptyString(item.name) &&
			typeof item.value === 'string' &&
			PROPERTY_TYPES.includes(item.type as never)
		) {
			value.push({ name: item.name, value: item.value, type: item.type as PropertyDef['type'] });
		} else {
			problems.push(`${label}: a property needs a name, a text value and a known type`);
		}
	}
	return { value, problems };
}

const OPTIONAL_TEXT_FIELDS = ['prompt', 'context', 'noteNameFormat', 'noteContentFormat', 'engineId'] as const;
const OPTIONAL_BOOLEAN_FIELDS = ['omitEmptyProperties', 'skipPreview', 'openAfterCreate'] as const;

/**
 * Validates one template. With `requireId`, a template without an id is
 * rejected; imported templates are checked without one, since import gives
 * each template a new id (20.0.4).
 */
export function checkTemplate(raw: unknown, options: { requireId: boolean }): Checked<Template> {
	if (!isRecord(raw)) return { value: undefined, problems: ['A template entry isn\'t an object'] };
	const label = isNonEmptyString(raw.name) ? `Template "${raw.name}"` : 'A template';
	if (!isNonEmptyString(raw.name)) return { value: undefined, problems: [`${label} has no name`] };
	if (options.requireId && !isNonEmptyString(raw.id)) return { value: undefined, problems: [`${label} has no id`] };

	const template: Template = { id: isNonEmptyString(raw.id) ? raw.id : '', name: raw.name };
	const problems: string[] = [];
	for (const key of OPTIONAL_TEXT_FIELDS) {
		if (raw[key] === undefined) continue;
		if (typeof raw[key] === 'string') template[key] = raw[key];
		else problems.push(`${label}: "${key}" must be text`);
	}
	for (const key of OPTIONAL_BOOLEAN_FIELDS) {
		if (raw[key] === undefined) continue;
		if (typeof raw[key] === 'boolean') template[key] = raw[key];
		else problems.push(`${label}: "${key}" must be true or false`);
	}
	const location = checkLocation(raw.location, label);
	if (location.value) template.location = location.value;
	problems.push(...location.problems);

	const properties = checkProperties(raw.properties, label);
	if (properties.value) template.properties = properties.value;
	problems.push(...properties.problems);

	const tagging = checkTaggingOverrides(raw.tagging, label);
	if (tagging.value) template.tagging = tagging.value;
	problems.push(...tagging.problems);

	if (raw.references !== undefined) {
		if (
			isRecord(raw.references) &&
			(raw.references.enabled === undefined || typeof raw.references.enabled === 'boolean') &&
			(raw.references.heading === undefined || typeof raw.references.heading === 'string')
		) {
			template.references = {};
			if (raw.references.enabled !== undefined) template.references.enabled = raw.references.enabled;
			if (raw.references.heading !== undefined) template.references.heading = raw.references.heading;
		} else {
			problems.push(`${label}: references settings aren't valid`);
		}
	}
	if (raw.triggers !== undefined) {
		if (Array.isArray(raw.triggers) && raw.triggers.every((t) => typeof t === 'string')) template.triggers = [...(raw.triggers)];
		else problems.push(`${label}: triggers must be a list of text`);
	}
	if (
		isRecord(raw.origin) &&
		isNonEmptyString(raw.origin.builtInId) &&
		typeof raw.origin.version === 'number' &&
		typeof raw.origin.hash === 'string'
	) {
		template.origin = { builtInId: raw.origin.builtInId, version: raw.origin.version, hash: raw.origin.hash };
	}
	return { value: template, problems };
}

/** Validates the global config, filling anything missing or invalid from the built-in defaults. */
export function fillGlobal(raw: unknown): Checked<GlobalSettings> {
	const source = isRecord(raw) ? raw : {};
	const problems: string[] = [];
	const location = checkLocation(source.location, 'Global settings');
	problems.push(...location.problems);
	const tagging = fillTagging(source.tagging, DEFAULTS.tagging);
	problems.push(...tagging.problems);

	const references = isRecord(source.references) ? source.references : {};
	const global: GlobalSettings = {
		location: location.value ?? { ...DEFAULTS.location },
		tagging: tagging.value ?? { ...DEFAULTS.tagging },
		references: {
			enabled: typeof references.enabled === 'boolean' ? references.enabled : DEFAULTS.references.enabled,
			heading: typeof references.heading === 'string' ? references.heading : DEFAULTS.references.heading,
		},
		openAfterCreate: typeof source.openAfterCreate === 'boolean' ? source.openAfterCreate : DEFAULTS.openAfterCreate,
		collision: source.collision === 'ask' || source.collision === 'number' ? source.collision : DEFAULTS.collision,
		lmStudioPort:
			isPositiveInteger(source.lmStudioPort) && source.lmStudioPort <= 65535 ? source.lmStudioPort : DEFAULTS.lmStudioPort,
	};
	if (typeof source.noteNameFormat === 'string') global.noteNameFormat = source.noteNameFormat;
	return { value: global, problems };
}

/** Validates remembered popup state; unknown values are simply forgotten. */
export function fillUiState(raw: unknown): UiState {
	if (!isRecord(raw)) return {};
	const ui: UiState = {};
	if (typeof raw.lastTemplateId === 'string') ui.lastTemplateId = raw.lastTemplateId;
	const location = checkLocation(raw.lastLocation, 'Popup state');
	if (location.value) ui.lastLocation = location.value;
	return ui;
}
