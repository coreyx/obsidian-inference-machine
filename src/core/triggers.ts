import type { NoteSnapshot } from './note';
import type { Template } from './schema';
import { stripHash, tagFold } from './tags/normalize';

/**
 * Template triggers (REQ-22, design decision 10). A template can list rules,
 * one per line, and the popup preselects the first template, in template
 * order, with a rule matching the source note, much as Web Clipper's template
 * triggers pick a template for a web page.
 */

/** One parsed trigger rule. */
export type TriggerRule =
	/** The note has this tag, or a tag nested under it. Folded for comparison. */
	| { kind: 'tag'; tag: string }
	/** The note is in this folder or a folder inside it. Lowercased, without surrounding slashes. */
	| { kind: 'folder'; path: string }
	/** The note's frontmatter has this key, with this value when one is given. */
	| { kind: 'property'; key: string; value?: string }
	/** The expression matches the note's filename without extension, or its full contents. */
	| { kind: 'title' | 'content'; regex: RegExp };

/** A rule with the line it came from, which is what the popup shows when it matches. */
export interface ParsedTrigger {
	line: number;
	text: string;
	rule: TriggerRule;
}

/** A line that couldn't be read as a rule (22.0.6). Line numbers start at 1. */
export interface TriggerProblem {
	line: number;
	text: string;
	message: string;
}

const HELP = 'Use #tag, folder:<path>, property:<key> or property:<key>=<value>, title:/<regex>/ or content:/<regex>/.';

/** Parses a `/pattern/flags` expression, or explains why it can't. */
function parseRegex(source: string): RegExp | string {
	const match = /^\/(.*)\/([a-z]*)$/su.exec(source.trim());
	if (!match) return 'Write the expression between slashes, like /^Meeting/i.';
	// g and y make test() stateful between calls, which would make matching flaky.
	const flags = (match[2] ?? '').replace(/[gy]/gu, '');
	try {
		return new RegExp(match[1] ?? '', flags);
	} catch (error) {
		return `The expression isn't valid: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/** Parses one trigger line into a rule, or a problem message. */
function parseLine(text: string): TriggerRule | string {
	if (text.startsWith('#')) {
		const tag = tagFold(stripHash(text));
		if (tag === '' || /\s/u.test(tag)) return `"${text}" isn't a tag. ${HELP}`;
		return { kind: 'tag', tag: tag.replace(/\/+$/u, '') };
	}
	const colon = text.indexOf(':');
	const prefix = colon === -1 ? '' : text.slice(0, colon).trim().toLowerCase();
	const rest = colon === -1 ? '' : text.slice(colon + 1).trim();
	switch (prefix) {
		case 'folder': {
			const path = rest.replace(/^\/+|\/+$/gu, '').toLowerCase();
			if (path === '') return 'Name a folder after folder:, like folder:Meetings.';
			return { kind: 'folder', path };
		}
		case 'property': {
			const equals = rest.indexOf('=');
			const key = (equals === -1 ? rest : rest.slice(0, equals)).trim();
			if (key === '') return 'Name a property after property:, like property:type=book.';
			return equals === -1 ? { kind: 'property', key } : { kind: 'property', key, value: rest.slice(equals + 1).trim() };
		}
		case 'title':
		case 'content': {
			const regex = parseRegex(rest);
			return typeof regex === 'string' ? regex : { kind: prefix, regex };
		}
		default:
			return `Unknown trigger "${text}". ${HELP}`;
	}
}

/** Parses a template's trigger lines. Blank lines are skipped. */
export function parseTriggers(lines: readonly string[]): { triggers: ParsedTrigger[]; problems: TriggerProblem[] } {
	const triggers: ParsedTrigger[] = [];
	const problems: TriggerProblem[] = [];
	lines.forEach((raw, index) => {
		const text = raw.trim();
		if (text === '') return;
		const rule = parseLine(text);
		if (typeof rule === 'string') problems.push({ line: index + 1, text, message: rule });
		else triggers.push({ line: index + 1, text, rule });
	});
	return { triggers, problems };
}

/** A frontmatter value as text, for comparing with a trigger's value. */
function valueText(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(valueText);
	if (value === null || value === undefined) return [];
	if (value instanceof Date) return [value.toISOString().slice(0, 10)];
	if (typeof value === 'string') return [value];
	if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
	return [JSON.stringify(value) ?? ''];
}

/** Whether a rule matches a note. */
export function ruleMatches(rule: TriggerRule, note: NoteSnapshot): boolean {
	switch (rule.kind) {
		case 'tag':
			return [...note.frontmatterTags, ...note.inlineTags].some((tag) => {
				const folded = tagFold(tag);
				return folded === rule.tag || folded.startsWith(`${rule.tag}/`);
			});
		case 'folder': {
			const folder = note.folder.toLowerCase();
			return folder === rule.path || folder.startsWith(`${rule.path}/`);
		}
		case 'property': {
			const key = Object.keys(note.properties).find((k) => k.toLowerCase() === rule.key.toLowerCase());
			if (key === undefined) return false;
			if (rule.value === undefined) return true;
			const wanted = rule.value.toLowerCase();
			return valueText(note.properties[key]).some((v) => v.toLowerCase() === wanted);
		}
		case 'title':
			return rule.regex.test(note.title);
		case 'content':
			return rule.regex.test(note.content);
	}
}

/** The template a note's triggers choose, and the trigger that chose it. */
export interface TriggerMatch {
	template: Template;
	trigger: string;
}

/**
 * The first template, in list order, with a trigger that matches the note
 * (22.0.2). Lines that can't be parsed are skipped (22.0.6).
 */
export function matchTemplate(templates: readonly Template[], note: NoteSnapshot): TriggerMatch | undefined {
	for (const template of templates) {
		const { triggers } = parseTriggers(template.triggers ?? []);
		const hit = triggers.find((trigger) => ruleMatches(trigger.rule, note));
		if (hit) return { template, trigger: hit.text };
	}
	return undefined;
}
