import type { ChatRequest, ChatResult } from '../core/chat';
import type { EngineConfig } from '../core/schema';
import { NormalizedError, type Engine, type ModelInfo } from './engine';
import type { ErrorContext, Http, HttpRequest } from './transport';
import { requestJson, streamWithFallback } from './transport';

/** What every engine client needs from outside: the network, and a way to read stored keys. */
export interface EngineDeps {
	http: Http;
	/** Reads a key from Obsidian's SecretStorage by id (18.0.4). */
	getSecret: (id: string) => string | undefined;
}

/** Output-token limit for Anthropic when the engine sets none: its API requires one (3.0.11). */
export const ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** The tiny request "Test" sends (3.0.5). */
export const TEST_REQUEST: ChatRequest = { user: 'Reply with the single word OK.', maxOutputTokens: 16 };

/** Accumulates streamed text and the truncation flag. */
export class StreamState {
	text = '';
	truncated = false;

	/** The result once the stream is done. */
	result(): ChatResult {
		return { text: this.text, truncated: this.truncated, streamed: true };
	}
}

/**
 * Shared plumbing for the provider clients: credentials, error context and
 * the stream-or-fallback flow. Each subclass maps `ChatRequest` to its wire
 * format (design.md, "Provider wire formats").
 */
export abstract class BaseEngine implements Engine {
	constructor(
		protected readonly config: EngineConfig,
		protected readonly deps: EngineDeps,
	) {}

	/** The stored key, if the engine has one. */
	protected secret(): string | undefined {
		return this.config.secretId ? this.deps.getSecret(this.config.secretId) : undefined;
	}

	/** The stored key, for providers that can't work without one. */
	protected requireSecret(): string {
		const secret = this.secret();
		if (!secret) {
			throw new NormalizedError('auth', `${this.config.name} has no API key. Add one in this engine's settings.`);
		}
		return secret;
	}

	/** The base URL without a trailing slash. */
	protected base(defaultUrl: string): string {
		return (this.config.baseUrl?.trim() || defaultUrl).replace(/\/+$/u, '');
	}

	protected context(url: string): ErrorContext {
		return { engineName: this.config.name, url, secret: this.secret() };
	}

	/**
	 * The output-token limit to send, or undefined to send none, so the
	 * provider's or model's own default applies (3.0.11).
	 */
	protected maxOutputTokens(request: ChatRequest): number | undefined {
		return request.maxOutputTokens ?? this.config.maxOutputTokens;
	}

	protected temperature(request: ChatRequest): number | undefined {
		return request.temperature ?? this.config.temperature;
	}

	/** Sends a JSON request through `requestUrl`. */
	protected async send(request: HttpRequest): Promise<unknown> {
		return requestJson(this.deps.http, request, this.context(request.url));
	}

	/** Streams through `fetch` where allowed, otherwise falls back to `complete` (design decision 6). */
	protected streamVia(
		request: HttpRequest,
		chatRequest: ChatRequest,
		onEvent: (data: string, event: string | undefined, state: StreamState) => boolean | void,
		onDelta: (text: string) => void,
		signal: AbortSignal,
		blockedHint: string,
	): Promise<ChatResult> {
		const state = new StreamState();
		return streamWithFallback({
			http: this.deps.http,
			engineKey: this.config.id,
			request,
			signal,
			context: this.context(request.url),
			onEvent: (event) => {
				const before = state.text.length;
				const done = onEvent(event.data, event.event, state);
				if (state.text.length > before) onDelta(state.text.slice(before));
				return done;
			},
			finish: () => state.result(),
			fallback: async () => {
				const result = await this.complete(chatRequest);
				// The live view should still show the text, all at once.
				if (result.text !== '') onDelta(result.text);
				return result;
			},
			blockedHint,
		});
	}

	/** Parses one streamed event's JSON data, turning malformed data into a provider error. */
	protected parseEvent(data: string): Record<string, unknown> {
		try {
			const parsed = JSON.parse(data) as unknown;
			if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
		} catch {
			// Fall through.
		}
		throw new NormalizedError('provider', `${this.config.name} sent a streaming event that couldn't be read.`);
	}

	/** Throws a provider error for an error object a provider put in a successful response or stream. */
	protected failWith(error: unknown): never {
		const message =
			typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).message === 'string'
				? ((error as Record<string, unknown>).message as string)
				: 'an unknown error';
		throw new NormalizedError('provider', `${this.config.name} reported an error: ${message}`);
	}

	abstract stream(request: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<ChatResult>;
	abstract complete(request: ChatRequest, options?: { json?: boolean }): Promise<ChatResult>;
	abstract listModels(): Promise<ModelInfo[]>;

	async test(): Promise<void> {
		await this.complete(TEST_REQUEST);
	}
}

/** Reads a nested value from parsed JSON without trusting its shape. */
export function dig(value: unknown, ...path: (string | number)[]): unknown {
	let current = value;
	for (const key of path) {
		if (typeof current !== 'object' || current === null) return undefined;
		current = (current as Record<string | number, unknown>)[key];
	}
	return current;
}

/** Reads an array from parsed JSON, or an empty one. */
export function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Reads a string from parsed JSON, or an empty one. */
export function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
