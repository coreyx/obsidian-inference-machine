/**
 * The long-note check (REQ-16). A character-based estimate is deliberately
 * rough: it only has to flag "probably too big" before anything is sent, it
 * needs no network call, and each provider tokenizes differently anyway
 * (tech.md, "Token estimation").
 */

/** Characters per token for the estimate. A little under the usual 4 for English, to err on the side of warning. */
const CHARS_PER_TOKEN = 3.5;

/** Estimates how many tokens a text uses. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Whether a request fits the engine's context window. */
export type FitCheck =
	| { status: 'fits' | 'over'; estimate: number; limit: number }
	/** The engine's context window isn't known, so no warning is possible (16.0.4). */
	| { status: 'unknown'; estimate: number };

/**
 * Compares a request with the room the context window leaves after the
 * reply: the window minus the maximum output tokens (tech.md).
 */
export function checkFits(requestText: string, contextWindow: number | undefined, maxOutputTokens: number | undefined): FitCheck {
	const estimate = estimateTokens(requestText);
	if (contextWindow === undefined || contextWindow <= 0) return { status: 'unknown', estimate };
	const limit = Math.max(0, contextWindow - (maxOutputTokens ?? 0));
	return { status: estimate > limit ? 'over' : 'fits', estimate, limit };
}
