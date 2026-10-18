/**
 * Reasoning in responses (8.0.8, Q33). Some reasoning models, often local
 * ones, write their working into the answer text between `<think>` and
 * `</think>` instead of sending it separately. That working isn't part of
 * the answer, so it's removed before a response becomes a note, an inline
 * prompt answer or a list of tags.
 */

const COMPLETE_BLOCK = /<think>[\s\S]*?<\/think>/giu;
const CLOSING_TAG = /<\/think>/iu;
const OPENING_TAG = /<think>/iu;

/**
 * Removes reasoning from a response:
 *
 * - every complete `<think>…</think>` block
 * - everything before a `</think>` with no opening tag, which some servers
 *   send when they strip the opening tag but leave the working in
 * - a `<think>` block still open at the end, as when the output limit cut the
 *   model off mid-thought
 */
export function stripReasoning(text: string): string {
	let result = text.replace(COMPLETE_BLOCK, '');
	const closing = CLOSING_TAG.exec(result);
	if (closing) result = result.slice(closing.index + closing[0].length);
	const opening = OPENING_TAG.exec(result);
	if (opening) result = result.slice(0, opening.index);
	return result.replace(/^\s+/u, '');
}

/** The explanation for a response that hit the output limit before any answer (8.0.9). */
export function outputLimitMessage(engineName: string, what: string): string {
	return `${engineName} used its whole output limit before writing ${what}, which usually means a reasoning model spent it all reasoning. Raise the engine's maximum output tokens, or leave the field empty to use the model's own limit.`;
}
