import { requestUrl } from 'obsidian';
import type { ChatResult } from '../core/chat';
import { NormalizedError, redact } from './engine';
import { SseParser, type SseEvent } from './sse';

/**
 * The two transports (tech.md, "Networking and streaming"):
 *
 * - `request` goes through Obsidian's `requestUrl`, which isn't subject to
 *   CORS on desktop or mobile but can't stream.
 * - `stream` goes through the browser's `fetch`, which can stream but only
 *   reaches endpoints that allow cross-origin requests.
 *
 * Both sit behind the `Http` interface so engine clients can be tested with
 * recorded fixtures and no network.
 */

/** One HTTP request. */
export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

/** A complete HTTP response. */
export interface HttpResponse {
	status: number;
	text: string;
}

/** A streaming HTTP response. */
export interface HttpStreamResponse {
	status: number;
	body: ReadableStream<Uint8Array> | null;
	text(): Promise<string>;
}

/** The network surface engine clients use. */
export interface Http {
	/** Sends a request without CORS restrictions and waits for the whole response. Throws only on network failure. */
	request(request: HttpRequest): Promise<HttpResponse>;
	/** Sends a request with `fetch` for a streaming response. Throws a `TypeError` when the request is blocked or can't connect. */
	stream(request: HttpRequest, signal: AbortSignal): Promise<HttpStreamResponse>;
}

/** The real transports, as Obsidian provides them. */
export const obsidianHttp: Http = {
	async request(request) {
		const response = await requestUrl({ ...request, throw: false });
		return { status: response.status, text: response.text };
	},
	async stream(request, signal) {
		// The lint rule prefers requestUrl, but requestUrl can't stream a response body.
		// fetch is used only here, for streaming, and every streaming request falls back
		// to requestUrl when fetch is blocked (tech.md, design decision 6).
		const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal });
		return { status: response.status, body: response.body, text: () => response.text() };
	},
};

/** What error messages need: who failed, and the secret to keep out of them. */
export interface ErrorContext {
	engineName: string;
	url: string;
	secret?: string;
}

/** The message a provider put in its error body, if there is one. */
function providerMessage(body: string): string | undefined {
	try {
		const parsed = JSON.parse(body) as unknown;
		const candidates: unknown[] = [];
		if (Array.isArray(parsed)) candidates.push(parsed[0]);
		else candidates.push(parsed);
		for (const value of candidates) {
			if (typeof value !== 'object' || value === null) continue;
			const record = value as Record<string, unknown>;
			const error = record.error;
			if (typeof error === 'string') return error;
			if (typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).message === 'string') {
				return (error as Record<string, unknown>).message as string;
			}
			if (typeof record.message === 'string') return record.message;
		}
	} catch {
		// Not JSON: fall through to the raw text.
	}
	const text = body.trim();
	return text === '' ? undefined : text.slice(0, 300);
}

const CONTEXT_LENGTH = /context[_ ]length|context window|maximum context|too many tokens|prompt is too long|input is too long|exceeds the (?:maximum|limit)/iu;

/** Turns an HTTP error response into a plain-language, redacted error (3.4, 8.0.6, 18.2). */
export function httpError(status: number, body: string, context: ErrorContext): NormalizedError {
	const detail = providerMessage(body);
	const name = context.engineName;
	const withDetail = (message: string) => redact(detail ? `${message} The provider said: ${detail}` : message, context.secret);
	if (status === 401 || status === 403) {
		return new NormalizedError(
			'auth',
			withDetail(`${name} didn't accept the credentials (HTTP ${status}). Check the API key in this engine's settings.`),
			status,
		);
	}
	if (status === 429) {
		return new NormalizedError('rate-limit', withDetail(`${name} is limiting requests right now (HTTP 429). Wait a moment, then run again.`), status);
	}
	if (detail !== undefined && CONTEXT_LENGTH.test(detail)) {
		return new NormalizedError(
			'context-length',
			withDetail(`The request is too long for ${name}'s model (HTTP ${status}). Use a model with a larger context window, or a shorter note.`),
			status,
		);
	}
	if (status === 404) {
		return new NormalizedError(
			'not-found',
			withDetail(`${name} couldn't find the model or endpoint (HTTP 404). Check the model ID and base URL.`),
			status,
		);
	}
	return new NormalizedError('provider', withDetail(`${name} returned an error (HTTP ${status}).`), status);
}

/** The error for a request that never got a response. */
export function networkError(context: ErrorContext): NormalizedError {
	let host = context.url;
	try {
		host = new URL(context.url).host;
	} catch {
		// Keep the raw URL.
	}
	return new NormalizedError('network', redact(`Couldn't reach ${context.engineName} at ${host}. Check the base URL, your connection, and that the server is running.`, context.secret));
}

/** The error for a cancelled run. */
export function cancelledError(): NormalizedError {
	return new NormalizedError('cancelled', 'The run was cancelled.');
}

/** Sends a request through `requestUrl` and parses the JSON reply, normalizing every failure. */
export async function requestJson(http: Http, request: HttpRequest, context: ErrorContext): Promise<unknown> {
	let response: HttpResponse;
	try {
		response = await http.request(request);
	} catch {
		throw networkError(context);
	}
	if (response.status >= 400) throw httpError(response.status, response.text, context);
	if (response.text.trim() === '') throw new NormalizedError('empty', `${context.engineName} returned an empty response.`, response.status);
	try {
		return JSON.parse(response.text) as unknown;
	} catch {
		throw new NormalizedError('provider', `${context.engineName} returned a response that isn't JSON.`, response.status);
	}
}

/** Engines whose streaming request was blocked this session; later runs skip straight to `requestUrl` (design decision 6). */
const streamingBlocked = new Set<string>();

/** Forgets which engines had streaming blocked. For tests, and for when an engine's settings change. */
export function resetStreamingBlocked(engineKey?: string): void {
	if (engineKey === undefined) streamingBlocked.clear();
	else streamingBlocked.delete(engineKey);
}

/** How a streaming request is made, and how to get the same answer without streaming. */
export interface StreamPlan {
	http: Http;
	/** Identifies the engine for the session's `streamingBlocked` list. */
	engineKey: string;
	request: HttpRequest;
	signal: AbortSignal;
	context: ErrorContext;
	/** Handles one event; returns true once the stream says it's finished. */
	onEvent: (event: SseEvent) => boolean | void;
	/** Builds the result from what the events delivered. */
	finish: () => ChatResult;
	/** Makes the equivalent non-streaming request. */
	fallback: () => Promise<ChatResult>;
	/** Shown once, when streaming is first found to be blocked for this engine. */
	blockedHint: string;
}

/**
 * Streams a request with `fetch`, falling back to `requestUrl` (design
 * decision 6). A `TypeError` before any response arrives is how the browser
 * reports a blocked cross-origin request or a failed connection; the request
 * is then retried once without streaming, and the engine is remembered for
 * the rest of the session. An HTTP error response is a real error and is
 * never retried.
 */
export async function streamWithFallback(plan: StreamPlan): Promise<ChatResult> {
	if (streamingBlocked.has(plan.engineKey)) return plan.fallback();
	if (plan.signal.aborted) throw cancelledError();

	let response: HttpStreamResponse;
	try {
		response = await plan.http.stream(plan.request, plan.signal);
	} catch (error) {
		if (plan.signal.aborted) throw cancelledError();
		if (!(error instanceof TypeError)) throw networkError(plan.context);
		streamingBlocked.add(plan.engineKey);
		const result = await plan.fallback();
		return { ...result, notice: plan.blockedHint };
	}

	if (response.status >= 400) throw httpError(response.status, await response.text(), plan.context);
	if (!response.body) return plan.fallback();

	const parser = new SseParser();
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			const events = done ? parser.end() : parser.push(value);
			for (const event of events) {
				if (plan.onEvent(event) === true) {
					await reader.cancel();
					return plan.finish();
				}
			}
			if (done) return plan.finish();
		}
	} catch (error) {
		if (plan.signal.aborted) throw cancelledError();
		if (error instanceof NormalizedError) throw error;
		throw networkError(plan.context);
	}
}
