/** Types for the mock OpenAI-compatible server used by the end-to-end tests. */

/** The main reply the server sends for a generation request. */
export const MAIN_REPLY: string;

/** A request the server received. */
export interface RecordedRequest {
	method: string;
	path: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
}

/** A running mock server. */
export interface MockLlm {
	/** The OpenAI-compatible base URL, ending in /v1. */
	url: string;
	requests: RecordedRequest[];
	stop(): Promise<void>;
}

/** Starts the server; `cors: false` sends no CORS headers, so browsers block streaming. */
export function startMockLlm(options?: { port?: number; cors?: boolean }): Promise<MockLlm>;
