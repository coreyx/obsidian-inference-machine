import type { Http, HttpRequest, HttpResponse, HttpStreamResponse } from '../../src/engines/transport';

/** A body that arrives in the given chunks, as a network stream would. */
export function chunkedBody(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
			controller.close();
		},
	});
}

/** Scripted transports that record every request, for engine tests without a network. */
export class FakeHttp implements Http {
	readonly requests: HttpRequest[] = [];
	readonly streams: HttpRequest[] = [];

	constructor(
		private readonly onRequest: (request: HttpRequest) => HttpResponse | Promise<HttpResponse> = () => ({ status: 200, text: '{}' }),
		private readonly onStream: (request: HttpRequest, signal: AbortSignal) => HttpStreamResponse | Promise<HttpStreamResponse> = () => {
			throw new TypeError('Failed to fetch');
		},
	) {}

	async request(request: HttpRequest): Promise<HttpResponse> {
		this.requests.push(request);
		return this.onRequest(request);
	}

	async stream(request: HttpRequest, signal: AbortSignal): Promise<HttpStreamResponse> {
		this.streams.push(request);
		return this.onStream(request, signal);
	}
}

/** A successful streaming response made of SSE chunks. */
export function sseResponse(chunks: string[], status = 200): HttpStreamResponse {
	return { status, body: chunkedBody(chunks), text: async () => chunks.join('') };
}

/** A JSON response. */
export function json(value: unknown, status = 200): HttpResponse {
	return { status, text: JSON.stringify(value) };
}
