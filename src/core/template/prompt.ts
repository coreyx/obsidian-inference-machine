import { fileName, type NoteSnapshot } from '../note';
import { referencedVariables } from './knap';

/**
 * Builds the main request's prompt (5.0.5, Q13). A prompt that doesn't place
 * the note's contents itself, through `{{content}}` or `{{body}}`, gets the
 * filename and full contents appended, so "Summarize this." still has
 * something to summarize (5.4).
 *
 * @param promptTemplate The template's main prompt, before rendering.
 * @param rendered The same prompt after rendering.
 */
export function buildMainPrompt(promptTemplate: string, rendered: string, note: NoteSnapshot): string {
	const used = referencedVariables(promptTemplate);
	if (used.has('content') || used.has('body')) return rendered;
	return `${rendered.trimEnd()}\n\nFilename: ${fileName(note)}\n\n${note.content}`;
}
