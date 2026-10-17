import type { ChatRequest, ChatResult } from '../core/chat';

/**
 * The interface every engine client implements (design.md, "Interfaces"),
 * and the error type every client throws. Errors are normalized here so the
 * popup and settings can show one plain-language message per kind of
 * failure, whichever provider produced it (3.0.5, 8.0.6).
 */

/** A model an engine can use. */
export interface ModelInfo {
	id: string;
	/** A display name, where the provider gives one. */
	name?: string;
	/** Context window in tokens, where the provider reports it (3.0.9). */
	contextWindow?: number;
	/** LM Studio only: whether the model is loaded right now. */
	loaded?: boolean;
}

/** One configured AI engine. */
export interface Engine {
	/** Streams a reply, calling `onDelta` with each piece of text. Falls back to a single response where streaming is blocked. */
	stream(request: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<ChatResult>;
	/** Gets a whole reply at once. `json` asks for JSON output where the provider supports it natively. */
	complete(request: ChatRequest, options?: { json?: boolean }): Promise<ChatResult>;
	/** Lists the models the provider offers (3.0.4). */
	listModels(): Promise<ModelInfo[]>;
	/** Sends a minimal request, resolving when the engine works and throwing a NormalizedError when it doesn't (3.0.5). */
	test(): Promise<void>;
}

/** What went wrong, in terms the user can act on. */
export type ErrorKind =
	| 'auth'
	| 'rate-limit'
	| 'network'
	| 'cors'
	| 'not-found'
	| 'context-length'
	| 'provider'
	| 'empty'
	| 'cancelled';

/** An engine failure with a plain-language message that never contains a credential (18.0.3). */
export class NormalizedError extends Error {
	constructor(
		readonly kind: ErrorKind,
		message: string,
		readonly status?: number,
		readonly hint?: string,
	) {
		super(message);
		this.name = 'NormalizedError';
	}
}

/**
 * Replaces every occurrence of a secret in a message with `***` (18.0.3).
 * Provider error bodies sometimes echo part of the request back, so every
 * message is passed through this before it leaves the engine layer.
 */
export function redact(message: string, secret: string | undefined): string {
	if (!secret || secret.length < 4) return message;
	return message.split(secret).join('***');
}
