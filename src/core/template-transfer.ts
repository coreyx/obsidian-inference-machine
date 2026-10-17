import { checkTemplate, isRecord } from './data-validation';
import { DEFAULTS } from './defaults';
import { collectTemplatePrompts } from './inline';
import type { EngineConfig, Template } from './schema';
import { uniqueName } from './templates';

/**
 * Template files (REQ-20): JSON a user can back up, share and import, the
 * way Web Clipper's template files work (tech.md, "Lessons from Web
 * Clipper"). A file never contains credentials: a template's engine is
 * written by name only (20.0.3).
 */

/** Identifies the file format, so the format can change later. */
export const TEMPLATE_FILE_VERSION = '1';
export const TEMPLATE_FILE_PLUGIN = 'obsidian-inference-machine';

/** A template as it's written to a file: no id or origin, and the engine by name. */
export type TemplateExport = Omit<Template, 'id' | 'origin' | 'engineId'> & { engineName?: string };

/** A template file. */
export interface TemplateFile {
	schemaVersion: string;
	plugin: string;
	templates: TemplateExport[];
}

/** Writes templates to a template file (20.0.1). */
export function exportTemplates(templates: readonly Template[], engines: readonly EngineConfig[]): string {
	const file: TemplateFile = {
		schemaVersion: TEMPLATE_FILE_VERSION,
		plugin: TEMPLATE_FILE_PLUGIN,
		templates: templates.map((template) => {
			const { id: _id, origin: _origin, engineId, ...rest } = structuredClone(template);
			const exported: TemplateExport = rest;
			const engine = engines.find((e) => e.id === engineId);
			if (engine) exported.engineName = engine.name;
			return exported;
		}),
	};
	return `${JSON.stringify(file, null, '\t')}\n`;
}

/** The result of reading a template file: the new templates, or why the file was rejected. */
export type ImportResult = { ok: true; templates: Template[] } | { ok: false; error: string };

/**
 * Reads a template file into new user templates (20.0.2). The whole file is
 * checked before anything is accepted, so a bad file changes nothing
 * (20.0.5). Each template gets a new id and, when its name is taken, a
 * number (20.0.4). An engine named in the file is matched to an engine of
 * the same name; when there's none, the template uses the default (20.0.6).
 */
export function importTemplates(
	text: string,
	existing: readonly Template[],
	engines: readonly EngineConfig[],
	newId: () => string,
): ImportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: 'The file isn\'t valid JSON, so it can\'t be a template file.' };
	}
	if (!isRecord(parsed) || parsed.plugin !== TEMPLATE_FILE_PLUGIN || !Array.isArray(parsed.templates)) {
		return { ok: false, error: 'This isn\'t an Inference Machine template file.' };
	}
	if (parsed.schemaVersion !== TEMPLATE_FILE_VERSION) {
		return { ok: false, error: `This template file uses format version ${String(parsed.schemaVersion)}, which this version of the plugin can't read. Update the plugin and try again.` };
	}
	if (parsed.templates.length === 0) return { ok: false, error: 'The file has no templates in it.' };

	const imported: Template[] = [];
	const names = existing.map((t) => t.name);
	for (const raw of parsed.templates) {
		const checked = checkTemplate(raw, { requireId: false });
		if (!checked.value || checked.problems.length > 0) {
			return { ok: false, error: `The file has a problem, so nothing was imported. ${checked.problems[0] ?? 'A template isn\'t valid.'}` };
		}
		const template = checked.value;
		// Ids and origins from another vault mean nothing here.
		delete template.origin;
		delete template.engineId;
		const prompts = collectTemplatePrompts({
			noteNameFormat: template.noteNameFormat ?? DEFAULTS.noteNameFormat,
			propertyValues: (template.properties ?? []).map((p) => p.value),
			noteContentFormat: template.noteContentFormat ?? DEFAULTS.noteContentFormat,
		});
		if (!template.prompt?.trim() && prompts.length === 0) {
			return { ok: false, error: `The file has a problem, so nothing was imported. Template "${template.name}" has no main prompt and no inline prompts.` };
		}
		const engineName = isRecord(raw) && typeof raw.engineName === 'string' ? raw.engineName : undefined;
		const engine = engineName ? engines.find((e) => e.name.toLowerCase() === engineName.toLowerCase()) : undefined;
		if (engine) template.engineId = engine.id;
		template.id = newId();
		template.name = uniqueName(template.name, [...names, ...imported.map((t) => t.name)]);
		imported.push(template);
	}
	return { ok: true, templates: imported };
}
