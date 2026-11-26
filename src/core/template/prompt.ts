import { fileName, type NoteSnapshot } from '../note';
import { referencedVariables } from './knap';

/**
 * Builds the main request's prompt (5.0.5, Q13). A prompt that doesn't place
 * the note's contents itself, through `{{content}}` or `{{body}}`, gets the
 * filename and full contents appended, so "Summarize this." still has
 * something to summarize (5.4).
 *
 * In a selection run, the selection is appended instead, labeled as selected
 * text, with the source's frontmatter before it as context (Q56). There a
 * prompt that uses `{{selection}}` has placed the text itself.
 *
 * @param promptTemplate The template's main prompt, before rendering.
 * @param rendered The same prompt after rendering.
 */
export function buildMainPrompt(promptTemplate: string, rendered: string, note: NoteSnapshot): string {
	const used = referencedVariables(promptTemplate);
	const selection = note.selection;
	if (used.has('content') || used.has('body') || (selection !== undefined && used.has('selection'))) return rendered;
	const head = `${rendered.trimEnd()}\n\nFilename: ${fileName(note)}`;
	if (selection === undefined) return `${head}\n\n${note.content}`;
	const frontmatter = note.frontmatterText.trim() === '' ? '' : `\n\nFrontmatter:\n---\n${note.frontmatterText}\n---`;
	return `${head}${frontmatter}\n\nSelected text:\n\n${selection}`;
}
