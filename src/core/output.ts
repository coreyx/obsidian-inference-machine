import { isRecord } from './data-validation';
import type { PropertyType } from './schema';

/**
 * Turns a run's pieces into the output note's text (design decision 1): the
 * main AI output cleaned up, typed frontmatter properties, the final tags,
 * and the link back to the source. The text produced here is exactly what
 * the preview shows and what gets saved.
 *
 * YAML is parsed and written by functions passed in from the adapter layer
 * (Obsidian's `parseYaml` and `stringifyYaml`), so the core stays free of
 * Obsidian imports while frontmatter is handled the way Obsidian handles it.
 */

/** Parses YAML text into a value. May throw on invalid YAML. */
export type ParseYaml = (yaml: string) => unknown;
/** Writes a value as YAML text. */
export type StringifyYaml = (value: unknown) => string;

/** A frontmatter property after its template value has been rendered to text. */
export interface RenderedProperty {
	name: string;
	value: string;
	type: PropertyType;
}

/** A property with its value converted to the property's type. */
export interface TypedProperty {
	name: string;
	value: unknown;
}

const FENCE_OPEN = /^(`{3,}|~{3,})[^`\n]*$/u;

/**
 * Removes a code fence that encloses the whole response (8.0.5, 8.3), as
 * models often wrap Markdown in ```` ```markdown ````. A response with
 * anything outside the fence, or with more than one fenced block, is left
 * alone, since its fences are part of the content.
 */
export function stripEnclosingFence(text: string): string {
	const lines = text.trim().split('\n');
	const opening = FENCE_OPEN.exec(lines[0] ?? '');
	if (!opening || lines.length < 2) return text;
	const marker = opening[1]!;
	// A closing fence is the same character, at least as many times, and nothing else.
	const closes = (line: string) => {
		const trimmed = line.trimEnd();
		return trimmed.length >= marker.length && [...trimmed].every((c) => c === marker[0]);
	};
	if (!closes(lines[lines.length - 1]!)) return text;
	const inner = lines.slice(1, -1);
	// A closing line in the middle means the response is several blocks, not one enclosing fence.
	if (inner.some(closes)) return text;
	return inner.join('\n');
}

/**
 * Splits a leading YAML frontmatter block off the AI output (8.0.7). Output
 * whose block isn't valid YAML, or isn't a mapping, is left whole, so a
 * horizontal rule at the top of a note is never mistaken for frontmatter.
 */
export function splitLeadingFrontmatter(text: string, parseYaml: ParseYaml): { data?: Record<string, unknown>; body: string } {
	const match = /^\u{FEFF}?\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(text);
	if (!match) return { body: text };
	let data: unknown;
	try {
		data = parseYaml(match[1] ?? '');
	} catch {
		return { body: text };
	}
	if (!isRecord(data)) return { body: text };
	return { data, body: text.slice(match[0].length).replace(/^\s*\n/u, '') };
}

/** The main AI output after cleanup, split into its body and any frontmatter it carried. */
export interface PreparedOutput {
	body: string;
	/** Properties from the output's own frontmatter, minus `tags`. */
	properties: Record<string, unknown>;
	/** The output frontmatter's `tags`, which go through the tag pipeline as AI tags (8.0.7). */
	tags: string[];
}

/** Cleans up the main AI output: removes an enclosing fence, then splits off leading frontmatter. */
export function prepareOutput(raw: string, parseYaml: ParseYaml): PreparedOutput {
	const { data, body } = splitLeadingFrontmatter(stripEnclosingFence(raw), parseYaml);
	const properties: Record<string, unknown> = {};
	let tags: string[] = [];
	for (const [key, value] of Object.entries(data ?? {})) {
		if (key.toLowerCase() === 'tags') tags = tagList(value);
		else properties[key] = value;
	}
	return { body: body.trim(), properties, tags };
}

/**
 * Splits text on `, ` the way Web Clipper splits multitext values, without
 * breaking a `[[wikilink, with a comma]]` apart. A rendered JSON array, as
 * `{{properties.authors}}` produces for a list, is read as the list it is.
 */
export function splitList(text: string): string[] {
	const trimmed = text.trim();
	if (trimmed.startsWith('[') && !trimmed.startsWith('[[')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter((item) => item !== '');
		} catch {
			// Not JSON; split it as text.
		}
	}
	const items: string[] = [];
	let depth = 0;
	let current = '';
	for (let i = 0; i < text.length; i++) {
		if (text.startsWith('[[', i)) depth++;
		if (text.startsWith(']]', i)) depth = Math.max(0, depth - 1);
		if (depth === 0 && text.startsWith(', ', i)) {
			items.push(current);
			current = '';
			i++;
			continue;
		}
		current += text[i];
	}
	items.push(current);
	return items.map((item) => item.trim()).filter((item) => item !== '');
}

/** Reads a tags value, whether a list, a comma-separated string, or space-separated `#tags`. */
export function tagList(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap((item) => (typeof item === 'string' || typeof item === 'number' ? [String(item)] : []));
	if (typeof value !== 'string') return [];
	return value
		.split(/[,\s]+/u)
		.map((tag) => tag.trim())
		.filter((tag) => tag !== '');
}

/** Converts a rendered value to its property type. A value that doesn't fit the type stays text. */
export function coerceProperty(value: string, type: PropertyType): unknown {
	const text = value.trim();
	if (text === '') return type === 'multitext' ? [] : null;
	switch (type) {
		case 'text':
			return value;
		case 'multitext':
			return splitList(value);
		case 'number': {
			const n = Number(text);
			return Number.isFinite(n) ? n : value;
		}
		case 'checkbox':
			if (/^(true|yes)$/iu.test(text)) return true;
			if (/^(false|no)$/iu.test(text)) return false;
			return value;
		case 'date': {
			const date = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u.exec(text);
			return date ? date[1] : value;
		}
		case 'datetime': {
			const dateTime = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/u.exec(text);
			if (!dateTime || !/^[\d\-T :.Z+]*$/u.test(text)) return value;
			return `${dateTime[1]}T${dateTime[2] ?? '00:00'}`;
		}
	}
}

/** True for a property value that would be written blank (15.0.8). */
export function isEmptyProperty(value: unknown): boolean {
	return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Types a template's rendered properties. A property named `tags` doesn't
 * go into the frontmatter directly: its values become the template's tags
 * for the tag pipeline (11.0.2, 21.0.9).
 */
export function typeProperties(rendered: RenderedProperty[]): { properties: TypedProperty[]; templateTags: string[] } {
	const properties: TypedProperty[] = [];
	const templateTags: string[] = [];
	for (const property of rendered) {
		if (property.name.toLowerCase() === 'tags') templateTags.push(...tagList(splitList(property.value)));
		else properties.push({ name: property.name, value: coerceProperty(property.value, property.type) });
	}
	return { properties, templateTags };
}

/** Whether a line opens or closes a fenced code block, ignoring indentation of up to three spaces. */
function isFenceLine(line: string): boolean {
	return /^ {0,3}(`{3,}|~{3,})/u.test(line);
}

/** The level of an ATX heading line (`## Sources` is 2), or undefined for other lines. */
function headingLevel(line: string): number | undefined {
	const match = /^ {0,3}(#{1,6})(?:[ \t]|$)/u.exec(line);
	return match ? match[1]!.length : undefined;
}

/**
 * Adds the link back to the source (10.0.5, 10.0.6). If the note already
 * has the references heading, outside code blocks, the link goes at the end
 * of that heading's section; otherwise the heading is added at the end.
 */
export function addReferenceLink(body: string, heading: string, link: string): string {
	const wanted = heading.trim();
	const ownLevel = headingLevel(wanted) ?? 7;
	const lines = body.split('\n');
	let inFence = false;
	let start = -1;
	let end = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (isFenceLine(line)) inFence = !inFence;
		if (inFence) continue;
		if (start === -1) {
			if (line.trimEnd() === wanted) start = i;
			continue;
		}
		const level = headingLevel(line);
		if (level !== undefined && level <= ownLevel) {
			end = i;
			break;
		}
	}

	const item = `- ${link}`;
	if (start === -1) {
		const gap = headingLevel(wanted) === undefined ? '\n' : '\n\n';
		return `${body.trimEnd()}${body.trim() === '' ? '' : '\n\n'}${wanted}${gap}${item}\n`;
	}
	let insertAt = end;
	while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
	lines.splice(insertAt, 0, item);
	return lines.join('\n');
}

/**
 * Puts a blank line after every ATX heading outside code blocks, so every
 * note reads the same whichever template or model wrote it. Models often
 * follow a heading directly with text even when the prompt's example has a
 * blank line, and a template's body format may not have one either.
 */
export function blankLineAfterHeadings(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		out.push(line);
		if (isFenceLine(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || headingLevel(line) === undefined) continue;
		const next = lines[i + 1];
		if (next !== undefined && next.trim() !== '') out.push('');
	}
	return out.join('\n');
}

/** Everything the final note is built from. */
export interface AssembleInput {
	/** The rendered body wrapper. */
	body: string;
	/** The template's typed properties, in template order. */
	properties: TypedProperty[];
	/** Properties from the AI output's frontmatter. The template's win on conflicts (8.0.7). */
	aiProperties: Record<string, unknown>;
	/** The tag pipeline's result. */
	tags: string[];
	/** Where to link back to the source; left out when the link is off. */
	references?: { heading: string; link: string };
	/** Embeds of the source's leading images, put at the top of the body. */
	leadingImages?: readonly string[];
	omitEmptyProperties: boolean;
	stringifyYaml: StringifyYaml;
}

/** Builds the complete note text: YAML frontmatter, then the body. */
export function assembleNote(input: AssembleInput): string {
	const frontmatter: Record<string, unknown> = {};
	for (const { name, value } of input.properties) frontmatter[name] = value;
	for (const [name, value] of Object.entries(input.aiProperties)) {
		// Template properties win, matched the way Obsidian matches property names.
		if (!Object.keys(frontmatter).some((existing) => existing.toLowerCase() === name.toLowerCase())) frontmatter[name] = value;
	}
	if (input.omitEmptyProperties) {
		for (const [name, value] of Object.entries(frontmatter)) if (isEmptyProperty(value)) delete frontmatter[name];
	}
	if (input.tags.length > 0) frontmatter.tags = [...input.tags];

	let body = input.body;
	if (input.leadingImages && input.leadingImages.length > 0) {
		const images = input.leadingImages.join('\n');
		body = body.trim() === '' ? images : `${images}\n\n${body}`;
	}
	if (input.references) body = addReferenceLink(body, input.references.heading, input.references.link);
	body = blankLineAfterHeadings(body);
	if (!body.endsWith('\n')) body += '\n';

	if (Object.keys(frontmatter).length === 0) return body;
	const yaml = input.stringifyYaml(frontmatter);
	return `---\n${yaml}${yaml.endsWith('\n') ? '' : '\n'}---\n${body}`;
}
