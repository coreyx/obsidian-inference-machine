import type { ChatRequest, ChatResult } from '../core/chat';
import { BaseEngine, dig, list, type StreamState } from './base';
import { NormalizedError, type ModelInfo } from './engine';
import { knownContextWindow } from './model-metadata';
import type { HttpRequest } from './transport';

const DEFAULT_BASE = 'https://api.openai.com/v1';

/**
 * OpenAI's Chat Completions API, which also serves every OpenAI-compatible
 * endpoint, LM Studio included (tech.md). The two provider types differ in
 * three ways (design.md, "Provider wire formats"):
 *
 * - an OpenAI-compatible engine sends `Authorization` only when it has a key (3.0.10)
 * - it sends `max_tokens`, which more servers support, rather than `max_completion_tokens`
 * - it asks for JSON by instruction only, since servers' JSON-mode support varies
 */
export class OpenAiEngine extends BaseEngine {
	private get compatible(): boolean {
		return this.config.provider === 'openai-compatible';
	}

	private baseUrl(): string {
		if (this.compatible && !this.config.baseUrl?.trim()) {
			throw new NormalizedError('not-found', `${this.config.name} has no base URL. Add one in this engine's settings.`);
		}
		return this.base(DEFAULT_BASE);
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		const key = this.compatible ? this.secret() : this.requireSecret();
		if (key) headers.authorization = `Bearer ${key}`;
		return headers;
	}

	private chat(request: ChatRequest, options: { stream: boolean; json?: boolean }): HttpRequest {
		const messages: { role: string; content: string }[] = [];
		if (request.system) messages.push({ role: 'system', content: request.system });
		messages.push({ role: 'user', content: request.user });
		const body: Record<string, unknown> = { model: this.config.model, messages };
		const limit = this.maxOutputTokens(request);
		if (limit !== undefined) body[this.compatible ? 'max_tokens' : 'max_completion_tokens'] = limit;
		const temperature = this.temperature(request);
		if (temperature !== undefined) body.temperature = temperature;
		if (options.stream) body.stream = true;
		if (options.json && !this.compatible) body.response_format = { type: 'json_object' };
		return { url: `${this.baseUrl()}/chat/completions`, method: 'POST', headers: this.headers(), body: JSON.stringify(body) };
	}

	async complete(request: ChatRequest, options?: { json?: boolean }): Promise<ChatResult> {
		const response = await this.send(this.chat(request, { stream: false, json: options?.json }));
		const error = dig(response, 'error');
		if (error) this.failWith(error);
		const choice = list(dig(response, 'choices'))[0];
		const content = dig(choice, 'message', 'content');
		return { text: typeof content === 'string' ? content : '', truncated: dig(choice, 'finish_reason') === 'length', streamed: false };
	}

	async stream(request: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<ChatResult> {
		const isLocal = this.compatible;
		return this.streamVia(
			this.chat(request, { stream: true }),
			request,
			(data, _event, state: StreamState) => {
				if (data.trim() === '[DONE]') return true;
				const event = this.parseEvent(data);
				if (event.error) this.failWith(event.error);
				for (const choice of list(event.choices)) {
					const delta = dig(choice, 'delta', 'content');
					if (typeof delta === 'string') state.text += delta;
					if (dig(choice, 'finish_reason') === 'length') state.truncated = true;
				}
				return undefined;
			},
			onDelta,
			signal,
			isLocal
				? `Streaming is blocked for ${this.config.name}, so its output appears when it's complete. To stream, allow cross-origin requests (CORS) in the server's settings, such as LM Studio's "Enable CORS".`
				: `Streaming isn't available for ${this.config.name} from Obsidian, so its output appears when it's complete.`,
		);
	}

	async listModels(): Promise<ModelInfo[]> {
		const response = await this.send({ url: `${this.baseUrl()}/models`, method: 'GET', headers: this.headers() });
		return list(dig(response, 'data')).flatMap((model) => {
			const id = dig(model, 'id');
			if (typeof id !== 'string') return [];
			const info: ModelInfo = { id };
			// Some compatible servers report a context length on their model list; OpenAI doesn't.
			const reported = dig(model, 'context_length') ?? dig(model, 'max_context_length');
			const contextWindow = typeof reported === 'number' ? reported : this.compatible ? undefined : knownContextWindow(id);
			if (contextWindow !== undefined) info.contextWindow = contextWindow;
			return [info];
		});
	}
}
