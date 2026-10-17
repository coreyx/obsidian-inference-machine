/**
 * Output filenames (10.0.3, 10.0.4).
 */

/**
 * Characters removed from filenames: those the file systems Obsidian runs on
 * reject (`\ / : * ? " < > |`), plus `# ^ [ ]`, which Obsidian refuses in
 * note names because they break links.
 */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/gu;

/** Long names are cut so the full path stays well under common file-system limits. */
const MAX_LENGTH = 200;

/**
 * Makes a rendered filename pattern safe to use as a note name: removes
 * illegal characters, line breaks and leading dots, collapses whitespace, and
 * falls back to `Untitled` when nothing is left.
 */
export function sanitizeFilename(name: string): string {
	const cleaned = name
		.replace(ILLEGAL, '')
		.replace(/\s+/gu, ' ')
		.trim()
		.replace(/^\.+/u, '')
		.trim();
	const cut = [...cleaned].slice(0, MAX_LENGTH).join('').trim();
	return cut === '' ? 'Untitled' : cut;
}

/** The name for the `n`th collision, numbered the way Obsidian numbers them: `Alpha - Summary 1`. */
export function numbered(name: string, n: number): string {
	return n === 0 ? name : `${name} ${n}`;
}
