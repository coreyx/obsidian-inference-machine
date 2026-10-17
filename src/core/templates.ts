import { BUILT_INS, type BuiltInTemplate } from './builtins';
import type { Template } from './schema';

/**
 * Managing the template list: built-in seeding and upgrades (design
 * decision 2), restoring and duplicating, and unique names.
 */

/** Serializes a value with sorted object keys, so equal content always serializes the same way. */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/**
 * A hash of a template's content: everything except its `id` and `origin`.
 * Comparing it with the hash recorded at install time tells an unedited
 * built-in from an edited one, with no separate "edited" flag to drift.
 * FNV-1a is enough here: this detects edits, it doesn't defend against anyone.
 */
export function hashTemplate(template: Omit<Template, 'id' | 'origin'> & { id?: string; origin?: unknown }): string {
	const { id: _id, origin: _origin, ...content } = template;
	const text = stableStringify(content);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A built-in as a user template, recording where it came from. */
export function instantiateBuiltIn(builtIn: BuiltInTemplate, id: string): Template {
	const content = structuredClone(builtIn.template);
	return { ...content, id, origin: { builtInId: builtIn.builtInId, version: builtIn.version, hash: hashTemplate(content) } };
}

/** Every built-in as a user template, for a new install (15.1). */
export function seedBuiltIns(newId: () => string, builtIns: readonly BuiltInTemplate[] = BUILT_INS): Template[] {
	return builtIns.map((builtIn) => instantiateBuiltIn(builtIn, newId()));
}

/**
 * Replaces each built-in copy that a newer release has updated, but only
 * when the user hasn't edited it (15.0.4). The copy keeps its id, so its
 * command and any "last used" memory still point at it.
 */
export function upgradeBuiltIns(templates: Template[], builtIns: readonly BuiltInTemplate[] = BUILT_INS): { templates: Template[]; upgraded: string[] } {
	const upgraded: string[] = [];
	const next = templates.map((template) => {
		const origin = template.origin;
		if (!origin) return template;
		const builtIn = builtIns.find((b) => b.builtInId === origin.builtInId);
		if (!builtIn || builtIn.version <= origin.version || hashTemplate(template) !== origin.hash) return template;
		upgraded.push(builtIn.template.name);
		return instantiateBuiltIn(builtIn, template.id);
	});
	return { templates: next, upgraded };
}

/** Returns `name`, or `name 1`, `name 2` and so on, whichever isn't taken (20.0.4). */
export function uniqueName(name: string, taken: Iterable<string>): string {
	const names = new Set([...taken].map((n) => n.toLowerCase()));
	if (!names.has(name.toLowerCase())) return name;
	for (let n = 1; ; n++) {
		const candidate = `${name} ${n}`;
		if (!names.has(candidate.toLowerCase())) return candidate;
	}
}

/** Adds back any built-in that's missing from the list ("Restore built-in templates"). */
export function restoreBuiltIns(templates: Template[], newId: () => string, builtIns: readonly BuiltInTemplate[] = BUILT_INS): { templates: Template[]; restored: string[] } {
	const present = new Set(templates.flatMap((t) => (t.origin ? [t.origin.builtInId] : [])));
	const restored: Template[] = [];
	for (const builtIn of builtIns) {
		if (present.has(builtIn.builtInId)) continue;
		const template = instantiateBuiltIn(builtIn, newId());
		template.name = uniqueName(template.name, [...templates, ...restored].map((t) => t.name));
		restored.push(template);
	}
	return { templates: [...templates, ...restored], restored: restored.map((t) => t.name) };
}

/** An editable copy of a template, without the built-in origin, so it's never upgraded over (15.0.3). */
export function duplicateTemplate(template: Template, newId: string, taken: Iterable<string>): Template {
	const { origin: _origin, ...content } = structuredClone(template);
	return { ...content, id: newId, name: uniqueName(`${template.name} copy`, taken) };
}
