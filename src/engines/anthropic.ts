import type { ChatRequest, ChatResult } from '../core/chat';
import { ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS, BaseEngine, dig, list, str, type StreamState } from './base';
import type { ModelInfo } from './engine';
import { knownContextWindow } from './model-metadata';
import type { HttpRequest } from './transport';

const DEFAULT_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

/** Anthropic's Messages API (design.md, "Provider wire formats"). */
export class AnthropicEngine extends BaseEngine {
	private headers(): Record<string, string> {
		return {
			'content-type': 'application/json',
			'x-api-key': this.requireSecret(),
			'anthropic-version': API_VERSION,
			// Required for requests from a browser context, which Obsidian is.
			'anthropic-dangerous-direct-browser-access': 'true',
		};
	}

	private messages(request: ChatRequest, stream: boolean): HttpRequest {
		const body: Record<string, unknown> = {
			model: this.config.model,
			// Anthropic's API requires max_tokens, so an unset limit gets a default (3.0.11).
			max_tokens: this.maxOutputTokens(request) ?? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
			messages: [{ role: 'user', content: request.user }],
		};
		if (request.system) body.system = request.system;
		const temperature = this.temperature(request);
		if (temperature !== undefined) body.temperature = temperature;
		if (stream) body.stream = true;
		return { url: `${this.base(DEFAULT_BASE)}/v1/messages`, method: 'POST', headers: this.headers(), body: JSON.stringify(body) };
	}

	/** JSON mode is by instruction only for Anthropic (design.md); the request builders already ask for JSON. */
	async complete(request: ChatRequest): Promise<ChatResult> {
		const response = await this.send(this.messages(request, false));
		const text = list(dig(response, 'content'))
			.filter((block) => dig(block, 'type') === 'text')
			.map((block) => str(dig(block, 'text')))
			.join('');
		return { text, truncated: dig(response, 'stop_reason') === 'max_tokens', streamed: false };
	}

	async stream(request: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<ChatResult> {
		return this.streamVia(
			this.messages(request, true),
			request,
			(data, _event, state: StreamState) => {
				const event = this.parseEvent(data);
				switch (event.type) {
					case 'content_block_delta':
						if (dig(event, 'delta', 'type') === 'text_delta') state.text += str(dig(event, 'delta', 'text'));
						return undefined;
					case 'message_delta':
						if (dig(event, 'delta', 'stop_reason') === 'max_tokens') state.truncated = true;
						return undefined;
					case 'message_stop':
						return true;
					case 'error':
						return this.failWith(event.error);
					default:
						return undefined;
				}
			},
			onDelta,
			signal,
			`Streaming isn't available for ${this.config.name} from Obsidian, so its output appears when it's complete.`,
		);
	}

	async listModels(): Promise<ModelInfo[]> {
		const url = `${this.base(DEFAULT_BASE)}/v1/models?limit=1000`;
		const response = await this.send({ url, method: 'GET', headers: this.headers() });
		return list(dig(response, 'data')).flatMap((model) => {
			const id = dig(model, 'id');
			if (typeof id !== 'string') return [];
			const info: ModelInfo = { id };
			const name = dig(model, 'display_name');
			if (typeof name === 'string') info.name = name;
			const contextWindow = knownContextWindow(id);
			if (contextWindow !== undefined) info.contextWindow = contextWindow;
			return [info];
		});
	}
}
