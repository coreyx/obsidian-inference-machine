import type { ChatRequest, ChatResult } from '../../src/core/chat';
import type { Engine, ModelInfo } from '../../src/engines/engine';

/** A request the fake engine received, with how it was sent. */
export interface ReceivedRequest {
	request: ChatRequest;
	mode: 'stream' | 'complete';
	json: boolean;
}

/** Decides the fake engine's reply to a request: text, or an error to throw. */
export type Responder = (request: ChatRequest, mode: 'stream' | 'complete') => string | Error | Promise<string | Error>;

/**
 * An engine that answers from a script instead of a model, for tests of
 * everything above the engine layer. It records every request, and streams
 * a reply in a few pieces so live-output code sees real deltas.
 */
export class FakeEngine implements Engine {
	readonly received: ReceivedRequest[] = [];

	constructor(private readonly respond: Responder) {}

	async stream(request: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<ChatResult> {
		this.received.push({ request, mode: 'stream', json: false });
		const reply = await this.respond(request, 'stream');
		if (reply instanceof Error) throw reply;
		const pieces = reply.match(/[\s\S]{1,20}/gu) ?? [];
		for (const piece of pieces) {
			if (signal.aborted) throw Object.assign(new Error('The run was cancelled.'), { kind: 'cancelled' });
			onDelta(piece);
			await Promise.resolve();
		}
		return { text: reply, truncated: false, streamed: true };
	}

	async complete(request: ChatRequest, options?: { json?: boolean }): Promise<ChatResult> {
		this.received.push({ request, mode: 'complete', json: options?.json ?? false });
		const reply = await this.respond(request, 'complete');
		if (reply instanceof Error) throw reply;
		return { text: reply, truncated: false, streamed: false };
	}

	async listModels(): Promise<ModelInfo[]> {
		return [];
	}

	async test(): Promise<void> {}
}
