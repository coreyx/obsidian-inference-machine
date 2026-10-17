/**
 * The provider-neutral shape of one request to an engine. It lives in the
 * core so request builders (prompts, inline prompts, tagging) stay pure;
 * the engine clients in `src/engines` translate it to each wire format.
 */
export interface ChatRequest {
	system?: string;
	user: string;
	maxOutputTokens?: number;
	temperature?: number;
}

/** An engine's answer to one request. */
export interface ChatResult {
	text: string;
	/** The model stopped at its output-token limit, so the text is cut off. */
	truncated: boolean;
	/** The text arrived as a stream (false when streaming wasn't available). */
	streamed: boolean;
	/** Something the user should know about how the request went, such as why streaming was off. */
	notice?: string;
}
