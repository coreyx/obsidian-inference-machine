import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineConfig } from '../../src/core/schema';
import type { EngineDeps } from '../../src/engines/base';
import { createEngine, isLocalEngine } from '../../src/engines/factory';
import { knownContextWindow } from '../../src/engines/model-metadata';
import { resetStreamingBlocked, type HttpRequest } from '../../src/engines/transport';
import { FakeHttp, json, sseResponse } from './fake-http';

const secrets: Record<string, string> = { anthropic: 'sk-ant-KEY', openai: 'sk-OPENAI', gemini: 'AIza-GEMINI', lms: 'lms-TOKEN' };
const deps = (http: FakeHttp): EngineDeps => ({ http, getSecret: (id) => secrets[id] });
const body = (request: HttpRequest | undefined) => JSON.parse(request?.body ?? '{}') as Record<string, unknown>;
const signal = () => new AbortController().signal;
const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);

beforeEach(() => resetStreamingBlocked());

const anthropic: EngineConfig = { id: 'a', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5-5', secretId: 'anthropic', temperature: 0.3 };
const openai: EngineConfig = { id: 'o', name: 'GPT', provider: 'openai', model: 'gpt-5', secretId: 'openai', maxOutputTokens: 4000 };
const compatible: EngineConfig = { id: 'c', name: 'LM Studio', provider: 'openai-compatible', model: 'qwen3-8b', baseUrl: 'http://localhost:1234/v1/' };
const gemini: EngineConfig = { id: 'g', name: 'Gemini', provider: 'gemini', model: 'models/gemini-2.5-flash', secretId: 'gemini' };

describe('Anthropic', () => {
	it('sends the Messages request with the browser-access header', async () => {
		const http = new FakeHttp(() => json({ content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use' }, { type: 'text', text: '!' }], stop_reason: 'end_turn' }));
		const result = await createEngine(anthropic, deps(http)).complete({ system: 'Be brief.', user: 'Hi' });
		expect(result).toEqual({ text: 'Hello!', truncated: false, streamed: false });
		const [request] = http.requests;
		expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
		expect(request?.headers).toEqual({
			'content-type': 'application/json',
			'x-api-key': 'sk-ant-KEY',
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true',
		});
		expect(body(request)).toEqual({
			model: 'claude-sonnet-5-5',
			max_tokens: 8192,
			system: 'Be brief.',
			temperature: 0.3,
			messages: [{ role: 'user', content: 'Hi' }],
		});
	});

	it('flags output cut off at max_tokens', async () => {
		const http = new FakeHttp(() => json({ content: [{ type: 'text', text: 'Cut' }], stop_reason: 'max_tokens' }));
		expect((await createEngine(anthropic, deps(http)).complete({ user: 'x' })).truncated).toBe(true);
	});

	it('assembles streamed deltas and stops at message_stop', async () => {
		const events = [
			'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
			'event: ping\ndata: {"type":"ping"}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];
		const http = new FakeHttp(undefined, () => sseResponse(events));
		const deltas: string[] = [];
		const result = await createEngine(anthropic, deps(http)).stream({ user: 'x' }, (d) => deltas.push(d), signal());
		expect(result).toEqual({ text: 'Hello', truncated: true, streamed: true });
		expect(deltas).toEqual(['Hel', 'lo']);
		expect(body(http.streams[0])).toMatchObject({ stream: true });
	});

	it('turns a stream error event into a provider error', async () => {
		const http = new FakeHttp(undefined, () => sseResponse(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']));
		await expect(createEngine(anthropic, deps(http)).stream({ user: 'x' }, () => undefined, signal())).rejects.toMatchObject({
			kind: 'provider',
			message: 'Claude reported an error: Overloaded',
		});
	});

	it('lists models with known context windows, and needs a key', async () => {
		const http = new FakeHttp(() => json({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'mystery-model' }, { nope: 1 }] }));
		expect(await createEngine(anthropic, deps(http)).listModels()).toEqual([
			{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 200_000 },
			{ id: 'mystery-model' },
		]);
		expect(http.requests[0]?.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
		await expect(createEngine({ ...anthropic, secretId: undefined }, deps(http)).complete({ user: 'x' })).rejects.toMatchObject({
			kind: 'auth',
			message: 'Claude has no API key. Add one in this engine\'s settings.',
		});
	});
});

describe('OpenAI', () => {
	it('sends Chat Completions with max_completion_tokens and JSON mode', async () => {
		const http = new FakeHttp(() => json({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }));
		const result = await createEngine(openai, deps(http)).complete({ system: 'S', user: 'U' }, { json: true });
		expect(result.text).toBe('{"a":1}');
		const [request] = http.requests;
		expect(request?.url).toBe('https://api.openai.com/v1/chat/completions');
		expect(request?.headers.authorization).toBe('Bearer sk-OPENAI');
		expect(body(request)).toEqual({
			model: 'gpt-5',
			messages: [
				{ role: 'system', content: 'S' },
				{ role: 'user', content: 'U' },
			],
			max_completion_tokens: 4000,
			response_format: { type: 'json_object' },
		});
	});

	it('flags truncation and surfaces an error inside a successful response', async () => {
		const cut = new FakeHttp(() => json({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }));
		expect((await createEngine(openai, deps(cut)).complete({ user: 'x' })).truncated).toBe(true);
		const empty = new FakeHttp(() => json({ choices: [] }));
		expect(await createEngine(openai, deps(empty)).complete({ user: 'x' })).toEqual({ text: '', truncated: false, streamed: false });
		const failed = new FakeHttp(() => json({ error: { message: 'model overloaded' } }));
		await expect(createEngine(openai, deps(failed)).complete({ user: 'x' })).rejects.toMatchObject({ kind: 'provider' });
	});

	it('assembles streamed deltas up to [DONE]', async () => {
		const http = new FakeHttp(undefined, () =>
			sseResponse(sse([{ choices: [{ delta: { role: 'assistant' } }] }, { choices: [{ delta: { content: 'A' } }] }, { choices: [{ delta: { content: 'B' }, finish_reason: 'length' }] }, '[DONE]'])),
		);
		const deltas: string[] = [];
		expect(await createEngine(openai, deps(http)).stream({ user: 'x' }, (d) => deltas.push(d), signal())).toEqual({ text: 'AB', truncated: true, streamed: true });
		expect(deltas).toEqual(['A', 'B']);
	});

	it('reports an error event in the stream, and unreadable events', async () => {
		const failing = new FakeHttp(undefined, () => sseResponse(sse([{ error: { message: 'boom' } }])));
		await expect(createEngine(openai, deps(failing)).stream({ user: 'x' }, () => undefined, signal())).rejects.toMatchObject({ message: 'GPT reported an error: boom' });
		const garbled = new FakeHttp(undefined, () => sseResponse(['data: {not json\n\n']));
		await expect(createEngine(openai, deps(garbled)).stream({ user: 'x' }, () => undefined, signal())).rejects.toMatchObject({
			message: 'GPT sent a streaming event that couldn\'t be read.',
		});
		const noMessage = new FakeHttp(() => json({ error: 42 }));
		await expect(createEngine(openai, deps(noMessage)).complete({ user: 'x' })).rejects.toMatchObject({ message: 'GPT reported an error: an unknown error' });
	});

	it('lists models with table context windows', async () => {
		const http = new FakeHttp(() => json({ data: [{ id: 'gpt-4o-mini' }, { id: 'dall-e-3' }] }));
		expect(await createEngine(openai, deps(http)).listModels()).toEqual([{ id: 'gpt-4o-mini', contextWindow: 128_000 }, { id: 'dall-e-3' }]);
	});
});

describe('OpenAI-compatible (3.0.10, 3.8)', () => {
	const withKey: EngineConfig = { ...compatible, secretId: 'lms' };
	const auth = (r: HttpRequest | undefined) => r?.headers.authorization;

	it('sends the Bearer key on generation, model listing and Test when one is set', async () => {
		const http = new FakeHttp((r) => (r.method === 'GET' ? json({ data: [] }) : json({ choices: [{ message: { content: 'OK' } }] })));
		const engine = createEngine(withKey, deps(http));
		await engine.complete({ user: 'x' });
		await engine.listModels();
		await engine.test();
		expect(http.requests.map(auth)).toEqual(['Bearer lms-TOKEN', 'Bearer lms-TOKEN', 'Bearer lms-TOKEN']);
	});

	it('sends no Authorization header without a key', async () => {
		const http = new FakeHttp((r) => (r.method === 'GET' ? json({ data: [] }) : json({ choices: [{ message: { content: 'OK' } }] })));
		const engine = createEngine(compatible, deps(http));
		await engine.complete({ user: 'x' });
		await engine.listModels();
		await engine.test();
		expect(http.requests.map((r) => 'authorization' in r.headers)).toEqual([false, false, false]);
	});

	it('uses the base URL, max_tokens and no response_format', async () => {
		const http = new FakeHttp(() => json({ choices: [{ message: { content: 'x' } }] }));
		await createEngine(compatible, deps(http)).complete({ user: 'x' }, { json: true });
		expect(http.requests[0]?.url).toBe('http://localhost:1234/v1/chat/completions');
		expect(body(http.requests[0])).toEqual({ model: 'qwen3-8b', messages: [{ role: 'user', content: 'x' }] });
	});

	it('needs a base URL', async () => {
		await expect(createEngine({ ...compatible, baseUrl: ' ' }, deps(new FakeHttp())).complete({ user: 'x' })).rejects.toMatchObject({
			kind: 'not-found',
			message: 'LM Studio has no base URL. Add one in this engine\'s settings.',
		});
	});

	it('falls back without streaming when CORS blocks it, with a hint about CORS', async () => {
		const http = new FakeHttp(() => json({ choices: [{ message: { content: 'Full text' } }] }));
		const deltas: string[] = [];
		const result = await createEngine(compatible, deps(http)).stream({ user: 'x' }, (d) => deltas.push(d), signal());
		expect(result).toMatchObject({ text: 'Full text', streamed: false });
		expect(result.notice).toMatch(/Enable CORS/u);
		expect(deltas).toEqual(['Full text']);
	});

	it('reads a reported context length from the model list', async () => {
		const http = new FakeHttp(() => json({ data: [{ id: 'qwen3-8b', max_context_length: 32768 }, { id: 'gpt-4o' }] }));
		expect(await createEngine(compatible, deps(http)).listModels()).toEqual([{ id: 'qwen3-8b', contextWindow: 32768 }, { id: 'gpt-4o' }]);
	});
});

describe('Gemini', () => {
	it('sends generateContent with the key header and system instruction', async () => {
		const http = new FakeHttp(() =>
			json({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'Answer' }] }, finishReason: 'MAX_TOKENS' }] }),
		);
		const result = await createEngine({ ...gemini, temperature: 0 }, deps(http)).complete({ system: 'S', user: 'U' }, { json: true });
		expect(result).toEqual({ text: 'Answer', truncated: true, streamed: false });
		const [request] = http.requests;
		expect(request?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
		expect(request?.headers['x-goog-api-key']).toBe('AIza-GEMINI');
		expect(body(request)).toEqual({
			contents: [{ role: 'user', parts: [{ text: 'U' }] }],
			systemInstruction: { parts: [{ text: 'S' }] },
			generationConfig: { temperature: 0, responseMimeType: 'application/json' },
		});
	});

	it('streams with alt=sse', async () => {
		const chunk = (text: string, finishReason?: string) => ({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
		const http = new FakeHttp(undefined, () => sseResponse(sse([chunk('One '), chunk('two', 'STOP')])));
		const deltas: string[] = [];
		expect(await createEngine(gemini, deps(http)).stream({ user: 'x' }, (d) => deltas.push(d), signal())).toEqual({ text: 'One two', truncated: false, streamed: true });
		expect(http.streams[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
		expect(deltas).toEqual(['One ', 'two']);
	});

	it('reports a blocked prompt and an error object', async () => {
		const blocked = new FakeHttp(() => json({ promptFeedback: { blockReason: 'SAFETY' } }));
		await expect(createEngine(gemini, deps(blocked)).complete({ user: 'x' })).rejects.toMatchObject({ message: 'Gemini declined the request (SAFETY).' });
		const failed = new FakeHttp(() => json({ error: { message: 'quota' } }));
		await expect(createEngine(gemini, deps(failed)).complete({ user: 'x' })).rejects.toMatchObject({ message: 'Gemini reported an error: quota' });
	});

	it('lists generation models with their input limits', async () => {
		const http = new FakeHttp(() =>
			json({
				models: [
					{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
					{ name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
					{ name: 'models/bare', supportedGenerationMethods: ['generateContent'] },
				],
			}),
		);
		expect(await createEngine(gemini, deps(http)).listModels()).toEqual([
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576 },
			{ id: 'bare' },
		]);
	});
});

describe('output limits (3.0.11, 3.9)', () => {
	const reply = (r: HttpRequest) =>
		r.url.includes('anthropic') ? json({ content: [{ type: 'text', text: 'x' }] }) : r.url.includes('googleapis') ? json({ candidates: [] }) : json({ choices: [] });

	it('sends no limit when none is set, except to Anthropic, which gets 8,192', async () => {
		const sent: Record<string, unknown>[] = [];
		for (const config of [anthropic, openai, compatible, gemini].map((c) => ({ ...c, maxOutputTokens: undefined }))) {
			const http = new FakeHttp(reply);
			await createEngine(config, deps(http)).complete({ user: 'x' });
			sent.push(body(http.requests[0]));
		}
		expect(sent[0]).toMatchObject({ max_tokens: 8192 });
		expect(sent[1]).not.toHaveProperty('max_completion_tokens');
		expect(sent[2]).not.toHaveProperty('max_tokens');
		expect(sent[3]).toEqual({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], generationConfig: {} });
	});

	it('sends the engine setting when it has one', async () => {
		const sent: Record<string, unknown>[] = [];
		for (const config of [anthropic, openai, compatible, gemini].map((c) => ({ ...c, maxOutputTokens: 32000 }))) {
			const http = new FakeHttp(reply);
			await createEngine(config, deps(http)).complete({ user: 'x' });
			sent.push(body(http.requests[0]));
		}
		expect(sent.map((b) => b.max_tokens ?? b.max_completion_tokens ?? (b.generationConfig as Record<string, unknown>).maxOutputTokens)).toEqual([32000, 32000, 32000, 32000]);
	});
});

describe('errors from real HTTP failures', () => {
	it('normalizes an invalid key into an auth error without the key (3.4, 18.2)', async () => {
		for (const config of [anthropic, openai, gemini]) {
			const http = new FakeHttp(() => ({ status: 401, text: JSON.stringify({ error: { message: `Invalid API key: ${secrets[config.secretId!]}` } }) }));
			const error = (await createEngine(config, deps(http))
				.test()
				.catch((e: unknown) => e)) as Error & { kind: string };
			expect(error.kind).toBe('auth');
			expect(error.message).toContain(config.name);
			expect(error.message).not.toContain(secrets[config.secretId!]);
		}
	});
});

describe('helpers', () => {
	it('labels local engines (18.1)', () => {
		expect(isLocalEngine(compatible)).toBe(true);
		for (const url of ['http://127.0.0.1:1234/v1', 'http://192.168.1.20:11434/v1', 'http://[::1]:8080/v1', 'http://10.0.0.5/v1', 'http://172.20.0.2/v1', 'http://studio.local:1234/v1']) {
			expect(isLocalEngine({ ...compatible, baseUrl: url }), url).toBe(true);
		}
		expect(isLocalEngine({ ...compatible, baseUrl: 'https://openrouter.ai/api/v1' })).toBe(false);
		expect(isLocalEngine({ ...compatible, baseUrl: 'not a url' })).toBe(false);
		expect(isLocalEngine(anthropic)).toBe(false);
	});

	it('looks up context windows by longest prefix', () => {
		expect(knownContextWindow('gpt-4o-mini-2024')).toBe(128_000);
		expect(knownContextWindow('GPT-4.1-mini')).toBe(1_047_576);
		expect(knownContextWindow('gpt-4-0613')).toBe(8_192);
		expect(knownContextWindow('llama')).toBeUndefined();
	});
});
