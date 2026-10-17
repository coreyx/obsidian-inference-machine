import { checkEngine, checkTemplate, fillGlobal, fillUiState, isRecord } from '../core/data-validation';
import { defaultPluginData } from '../core/defaults';
import type { PluginData } from '../core/schema';
import { SCHEMA_VERSION } from '../core/schema';
import { seedBuiltIns, upgradeBuiltIns } from '../core/templates';

/**
 * Upgrades raw `data.json` from one schema version to the next. Keyed by the
 * version it upgrades *from*; each runs once, in order, on load.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** No shape changes have shipped yet, so there's nothing to migrate. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** The result of reading `data.json`. */
export interface NormalizedData {
	data: PluginData;
	/** Plain-language notes about entries that had to be dropped or reset. */
	warnings: string[];
	/** True when the normalized data differs from what was stored, so it should be saved back. */
	changed: boolean;
	/**
	 * True when the file came from a newer plugin version. It's loaded on a best-effort
	 * basis but never saved back, so downgrading doesn't destroy the newer data.
	 */
	fromNewerVersion: boolean;
}

/** Generates ids for new engines and templates. */
export const newId = (): string => crypto.randomUUID();

/**
 * Turns whatever `data.json` holds into valid `PluginData`: runs pending
 * migrations, fills missing fields from the defaults, drops entries that
 * can't be used (such as an engine with an unknown provider type),
 * reporting each one, and upgrades unedited built-in templates (15.0.4).
 * A new install, with no data at all, starts with the built-ins (15.1).
 */
export function normalizePluginData(
	raw: unknown,
	migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
	currentVersion: number = SCHEMA_VERSION,
	makeId: () => string = newId,
): NormalizedData {
	if (!isRecord(raw)) {
		const data = defaultPluginData();
		data.templates = seedBuiltIns(makeId);
		return { data, warnings: [], changed: true, fromNewerVersion: false };
	}
	const storedVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
	const fromNewerVersion = storedVersion > currentVersion;

	let migrated = raw;
	for (let version = storedVersion; version < currentVersion; version++) {
		const migration = migrations[version];
		if (migration) migrated = migration(migrated);
	}

	const warnings: string[] = [];
	if (fromNewerVersion) {
		warnings.push('These settings were saved by a newer version of Inference Machine. Update the plugin to edit them safely.');
	}

	const engines = [];
	for (const entry of Array.isArray(migrated.engines) ? migrated.engines : []) {
		const checked = checkEngine(entry);
		if (checked.value) engines.push(checked.value);
		else warnings.push(...checked.problems.map((p) => `${p}, so it was removed.`));
	}

	const templates = [];
	for (const entry of Array.isArray(migrated.templates) ? migrated.templates : []) {
		const checked = checkTemplate(entry, { requireId: true });
		if (checked.value) templates.push(checked.value);
		warnings.push(...checked.problems.map((p) => (checked.value ? `${p}; that setting was reset.` : `${p}, so it was removed.`)));
	}

	const global = fillGlobal(migrated.globalSettings);
	warnings.push(...global.problems.map((p) => `${p}; it was reset to the default.`));

	const data: PluginData = {
		schemaVersion: fromNewerVersion ? storedVersion : currentVersion,
		engines,
		globalSettings: global.value ?? defaultPluginData().globalSettings,
		// Data from a newer version is never rewritten, built-ins included.
		templates: fromNewerVersion ? templates : upgradeBuiltIns(templates).templates,
		ui: fillUiState(migrated.ui),
	};
	// A default that points at a deleted engine would silently resolve to nothing.
	if (typeof migrated.defaultEngineId === 'string' && engines.some((e) => e.id === migrated.defaultEngineId)) {
		data.defaultEngineId = migrated.defaultEngineId;
	}

	return { data, warnings, changed: JSON.stringify(data) !== JSON.stringify(raw), fromNewerVersion };
}

/** The part of Obsidian's `Plugin` the store needs: reading and writing `data.json`. */
export interface DataHost {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

/** Owns the in-memory `PluginData` and keeps `data.json` in step with it. */
export class SettingsStore {
	private current: PluginData = defaultPluginData();
	private readOnly = false;

	constructor(
		private readonly host: DataHost,
		private readonly migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
	) {}

	/** The current settings. Mutate them through `update` so they're saved. */
	get data(): PluginData {
		return this.current;
	}

	/** Loads `data.json`, saving it back when normalization changed it. Returns warnings to show the user. */
	async load(): Promise<string[]> {
		const result = normalizePluginData(await this.host.loadData(), this.migrations);
		this.current = result.data;
		this.readOnly = result.fromNewerVersion;
		if (result.changed && !this.readOnly) await this.host.saveData(this.current);
		return result.warnings;
	}

	/** Writes the current settings to `data.json`. */
	async save(): Promise<void> {
		if (this.readOnly) return;
		await this.host.saveData(this.current);
	}

	/** Applies a change to the settings and saves them. */
	async update(change: (data: PluginData) => void): Promise<void> {
		change(this.current);
		await this.save();
	}
}
