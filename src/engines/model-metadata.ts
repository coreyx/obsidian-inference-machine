/**
 * Known context windows for models whose APIs don't report one (tech.md,
 * "LM Studio detection and context windows"): Anthropic and OpenAI. Gemini
 * and LM Studio report their own. Entries match by model-ID prefix, longest
 * first, so `gpt-4o-mini` matches before `gpt-4`.
 *
 * This table goes stale as providers release models, which is why it's only
 * a default: the engine's context window is always editable, and the
 * long-note warning is advisory (REQ-16).
 */
const CONTEXT_WINDOWS: readonly [prefix: string, tokens: number][] = [
	// Anthropic: every current Claude model has at least a 200K window.
	['claude-', 200_000],
	// OpenAI
	['gpt-5', 400_000],
	['gpt-4.1', 1_047_576],
	['gpt-4o', 128_000],
	['gpt-4-turbo', 128_000],
	['gpt-4', 8_192],
	['gpt-3.5-turbo', 16_385],
	['o4-mini', 200_000],
	['o3', 200_000],
	['o1', 200_000],
];

const BY_LENGTH = [...CONTEXT_WINDOWS].sort((a, b) => b[0].length - a[0].length);

/** The known context window for a model ID, or undefined when the table has no entry. */
export function knownContextWindow(modelId: string): number | undefined {
	const id = modelId.toLowerCase();
	return BY_LENGTH.find(([prefix]) => id.startsWith(prefix))?.[1];
}
