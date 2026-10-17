import type { NoteSnapshot } from '../note';

/**
 * The template variables (REQ-6, design.md's variables table). Names follow
 * Web Clipper where the meaning is the same, so its users recognize them.
 */

/** Where a template field is used, which decides the variables it may read. */
export type TemplateField = 'prompt' | 'context' | 'output';

/** Variables every field may use. */
const NOTE_VARIABLES = [
	'title',
	'content',
	'body',
	'frontmatter',
	'properties',
	'path',
	'folder',
	'created',
	'modified',
	'date',
	'time',
	'template',
] as const;

/**
 * The variable names a field may use. `{{output}}`, the main AI output, only
 * exists once the main request has answered, so only the filename pattern,
 * property values and body wrapper can read it (6.0.2).
 */
export function knownVariables(field: TemplateField): ReadonlySet<string> {
	return new Set<string>(field === 'output' ? [...NOTE_VARIABLES, 'output'] : NOTE_VARIABLES);
}

/** What the variable map is built from besides the note itself. */
export interface VariableOptions {
	/** The template's name, for `{{template}}` (used in the default filename). */
	templateName: string;
	/** The run's start time, for `{{date}}` and `{{time}}`. */
	now: Date;
	/** The main AI output body. Left out for prompt and context rendering. */
	output?: string;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` in local time. */
export function formatDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `HH:mm` in local time. */
function formatTime(d: Date): string {
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm:ss` in local time, which the `date` filter can parse and reformat. */
function formatDateTime(d: Date): string {
	return `${formatDate(d)}T${formatTime(d)}:${pad(d.getSeconds())}`;
}

/**
 * Builds the variable map for rendering. A frontmatter key the note doesn't
 * have simply isn't in `properties`, and knap renders a missing value as
 * empty (6.0.3).
 */
export function buildVariables(note: NoteSnapshot, options: VariableOptions): Record<string, unknown> {
	const variables: Record<string, unknown> = {
		title: note.title,
		content: note.content,
		body: note.body,
		frontmatter: note.frontmatterText,
		properties: { ...note.properties },
		path: note.path,
		folder: note.folder,
		created: formatDateTime(new Date(note.ctime)),
		modified: formatDateTime(new Date(note.mtime)),
		date: formatDate(options.now),
		time: formatTime(options.now),
		template: options.templateName,
	};
	if (options.output !== undefined) variables.output = options.output;
	return variables;
}
