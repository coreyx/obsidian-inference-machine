import type { ChatRequest, ChatResult } from '../core/chat';
import { BaseEngine, dig, list, type StreamState } from './base';
import { NormalizedError, type ModelInfo } from './engine';
import type { HttpRequest } from './transport';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Google's Gemini API, `generateContent` and `streamGenerateContent` (design.md, "Provider wire formats"). */
export class GeminiEngine extends BaseEngine {
	private headers(): Record<string, string> {
		return { 'content-type': 'application/json', 'x-goog-api-key': this.requireSecret() };
	}

	/** The model's resource path. Accepts IDs with or without the `models/` prefix. */
	private modelPath(): string {
		return `models/${encodeURIComponent(this.config.model.replace(/^models\//u, ''))}`;
	}

	private generate(request: ChatRequest, options: { stream: boolean; json?: boolean }): HttpRequest {
		const generationConfig: Record<string, unknown> = { maxOutputTokens: this.maxOutputTokens(request) };
		const temperature = this.temperature(request);
		if (temperature !== undefined) generationConfig.temperature = temperature;
		if (options.json) generationConfig.responseMimeType = 'application/json';
		const body: Record<string, unknown> = {
			contents: [{ role: 'user', parts: [{ text: request.user }] }],
			generationConfig,
		};
		if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
		const method = options.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
		return { url: `${this.base(DEFAULT_BASE)}/${this.modelPath()}:${method}`, method: 'POST', headers: this.headers(), body: JSON.stringify(body) };
	}

	/** Reads one response chunk's text, noting truncation and refusing blocked prompts. */
	private read(response: unknown, state: { text: string; truncated: boolean }): void {
		const error = dig(response, 'error');
		if (error) this.failWith(error);
		const blocked = dig(response, 'promptFeedback', 'blockReason');
		if (typeof blocked === 'string') {
			throw new NormalizedError('provider', `${this.config.name} declined the request (${blocked}).`);
		}
		const candidate = list(dig(response, 'candidates'))[0];
		for (const part of list(dig(candidate, 'content', 'parts'))) {
			const text = dig(part, 'text');
			// Gemini "thinking" models mark their reasoning parts with thought: true; those aren't output.
			if (typeof text === 'string' && dig(part, 'thought') !== true) state.text += text;
		}
		if (dig(candidate, 'finishReason') === 'MAX_TOKENS') state.truncated = true;
	}

	async complete(request: ChatRequest, options?: { json?: boolean }): Promise<ChatResult> {
		const response = await this.send(this.generate(request, { stream: false, json: options?.json }));
		const state = { text: '', truncated: false };
		this.read(response, state);
		return { ...state, streamed: false };
	}

	async stream(request: ChatRequest, onDelta: (text: string) => void, signal: AbortSignal): Promise<ChatResult> {
		return this.streamVia(
			this.generate(request, { stream: true }),
			request,
			(data, _event, state: StreamState) => {
				this.read(this.parseEvent(data), state);
				return undefined;
			},
			onDelta,
			signal,
			`Streaming isn't available for ${this.config.name} from Obsidian, so its output appears when it's complete.`,
		);
	}

	async listModels(): Promise<ModelInfo[]> {
		const url = `${this.base(DEFAULT_BASE)}/models?pageSize=1000`;
		const response = await this.send({ url, method: 'GET', headers: this.headers() });
		return list(dig(response, 'models')).flatMap((model) => {
			const name = dig(model, 'name');
			const methods = list(dig(model, 'supportedGenerationMethods'));
			if (typeof name !== 'string' || !methods.includes('generateContent')) return [];
			const info: ModelInfo = { id: name.replace(/^models\//u, '') };
			const displayName = dig(model, 'displayName');
			if (typeof displayName === 'string') info.name = displayName;
			const limit = dig(model, 'inputTokenLimit');
			if (typeof limit === 'number') info.contextWindow = limit;
			return [info];
		});
	}
}
