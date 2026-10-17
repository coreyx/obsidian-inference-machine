import type { TagFormat } from '../schema';
import { stripHash } from './normalize';

/** Letters, marks, digits, pictographic emoji and the separators `_`, `-` and `/`. */
const ALLOWED_CHARACTER = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}_/-]$/u;

/**
 * Whether a tag may keep this character (13.0.4). Besides the characters
 * above, emoji need their building blocks: the zero-width joiner, the emoji
 * variation selector, flag letters and skin tones. Everything else, such as
 * `.`, `,`, `&` or a `#` inside the tag, is removed.
 */
function isAllowed(character: string): boolean {
	if (ALLOWED_CHARACTER.test(character)) return true;
	const code = character.codePointAt(0) ?? 0;
	return (
		code === 0x200d ||
		code === 0xfe0f ||
		(code >= 0x1f1e6 && code <= 0x1f1ff) ||
		(code >= 0x1f3fb && code <= 0x1f3ff)
	);
}

/** The outcome of making a tag valid: the cleaned tag, or why it had to be dropped. */
export type ValidatedTag = { ok: true; tag: string } | { ok: false; reason: 'invalid' };

/** Replaces runs of whitespace the way the format writes a word boundary. */
function replaceSpaces(tag: string, format: TagFormat): string {
	if (format === 'camel' || format === 'pascal') {
		// These formats mark a boundary by capitalizing the next word.
		return tag.replace(/\s+(\S)/gu, (_match, next: string) => next.toUpperCase());
	}
	const separator = format === 'snake' ? '_' : '-';
	return tag.replace(/\s+/gu, separator);
}

/** Collapses repeated separators and trims them from the ends of each `/` segment. */
function tidySegments(tag: string): string {
	return tag
		.split('/')
		.map((segment) => segment.replace(/-{2,}/gu, '-').replace(/_{2,}/gu, '_').replace(/^[-_]+|[-_]+$/gu, ''))
		.filter((segment) => segment !== '')
		.join('/');
}

/**
 * Makes a tag valid in Obsidian (13.0.4), or reports that it can't be: a tag
 * that ends up empty, or made only of digits like `1984`, is dropped (13.0.5).
 */
export function makeTagValid(tag: string, format: TagFormat): ValidatedTag {
	const spaced = replaceSpaces(stripHash(tag).normalize('NFC').trim(), format);
	const cleaned = tidySegments([...spaced].filter(isAllowed).join(''));
	if (cleaned === '' || /^\p{N}+$/u.test(cleaned)) return { ok: false, reason: 'invalid' };
	return { ok: true, tag: cleaned };
}
