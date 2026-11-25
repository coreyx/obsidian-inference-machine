import type { TemplateChoices, UiState } from './schema';

/**
 * Helpers for the popup's remembered choices (Q52, Q53). They mutate the
 * `UiState` they're given, so callers use them inside `SettingsStore.update`.
 * Kept free of Obsidian imports so the rules can be unit-tested.
 */

/** Remembers one choice for a template, creating its entry when needed. */
export function rememberChoice<K extends keyof TemplateChoices>(ui: UiState, templateId: string, field: K, value: TemplateChoices[K]): void {
	const choices = (ui.templateChoices ??= {});
	const entry = (choices[templateId] ??= {});
	entry[field] = value;
}

/**
 * Forgets the named choices for a template, so its own settings apply again
 * (Q61, Q62). An entry left with nothing in it is removed, and so is an
 * empty `templateChoices`, so `data.json` doesn't collect empty objects.
 */
export function forgetChoices(ui: UiState, templateId: string, fields: readonly (keyof TemplateChoices)[]): void {
	const entry = ui.templateChoices?.[templateId];
	if (!entry || !ui.templateChoices) return;
	for (const field of fields) delete entry[field];
	if (Object.keys(entry).length === 0) delete ui.templateChoices[templateId];
	if (Object.keys(ui.templateChoices).length === 0) delete ui.templateChoices;
}

/** True when a template has a remembered engine or location. */
export function hasChoices(ui: UiState, templateId: string | undefined): boolean {
	const entry = templateId === undefined ? undefined : ui.templateChoices?.[templateId];
	return entry?.engineId !== undefined || entry?.location !== undefined;
}

/**
 * Forgets what was remembered for templates and engines that no longer
 * exist: a deleted template's entry, a deleted engine's id, and a last
 * template that was deleted. Leaving them would keep dead ids in
 * `data.json` and, for a template re-created with the same id by an
 * import, bring back choices nobody made for it.
 */
export function pruneChoices(ui: UiState, templateIds: readonly string[], engineIds: readonly string[]): void {
	const templates = new Set(templateIds);
	const engines = new Set(engineIds);
	if (ui.lastTemplateId !== undefined && !templates.has(ui.lastTemplateId)) delete ui.lastTemplateId;
	for (const [templateId, entry] of Object.entries(ui.templateChoices ?? {})) {
		if (!templates.has(templateId)) {
			forgetChoices(ui, templateId, ['engineId', 'location']);
			continue;
		}
		if (entry.engineId !== undefined && !engines.has(entry.engineId)) forgetChoices(ui, templateId, ['engineId']);
	}
}
