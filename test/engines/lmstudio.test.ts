import { describe, expect, it } from 'vitest';
import type { EngineConfig } from '../../src/core/schema';
import { detectLmStudio, detectMessage, upsertLmStudioEngine } from '../../src/engines/lmstudio';
import type { HttpRequest, HttpResponse } from '../../src/engines/transport';
import { FakeHttp, json } from './fake-http';

/** LM Studio 0.4+ native API: models with loaded instances. */
const v1Models = {
	models: [
		{ type: 'llm', key: 'qwen/qwen3-8b', display_name: 'Qwen3 8B', max_context_length: 32768, loaded_instances: [{ id: 'qwen/qwen3-8b', config: { context_length: 8192 } }] },
		{ type: 'llm', key: 'google/gemma-3-12b', display_name: 'Gemma 3 12B', max_context_length: 131072, loaded_instances: [] },
		{ type: 'embedding', key: 'nomic-embed-text', loaded_instances: [] },
	],
};

/** LM Studio 0.3.6+ native API. */
const v0Models = {
	object: 'list',
	data: [
		{ id: 'llama-3.2-3b', type: 'llm', state: 'not-loaded', max_context_length: 131072 },
		{ id: 'phi-4', type: 'llm', state: 'loaded', loaded_context_length: 16384, max_context_length: 16384 },
		{ id: 'text-embedding', type: 'embeddings', state: 'loaded' },
	],
};

/** Routes probes by path; any path without a route gets a 404. */
function server(routes: Record<string, (r: HttpRequest) => HttpResponse>) {
	return new FakeHttp((request) => {
		const path = new URL(request.url).pathname;
		return routes[path]?.(request) ?? { status: 404, text: 'Not Found' };
	});
}

describe('detectLmStudio', () => {
	it('reads the v1 API, preferring a loaded model and its actual context length (4.1, 3.7)', async () => {
		const result = await detectLmStudio(server({ '/api/v1/models': () => json(v1Models) }), 1234);
		expect(result).toEqual({
			kind: 'ok',
			baseUrl: 'http://localhost:1234/v1',
			loadedModelId: 'qwen/qwen3-8b',
			models: [
				{ id: 'qwen/qwen3-8b', name: 'Qwen3 8B', loaded: true, contextWindow: 8192 },
				{ id: 'google/gemma-3-12b', name: 'Gemma 3 12B', loaded: false, contextWindow: 131072 },
			],
		});
	});

	it('falls back to the v0 API on older LM Studio', async () => {
		const http = server({ '/api/v0/models': () => json(v0Models) });
		const result = await detectLmStudio(http, 4321);
		expect(result).toMatchObject({ kind: 'ok', baseUrl: 'http://localhost:4321/v1', loadedModelId: 'phi-4' });
		expect(result.kind === 'ok' && result.models).toEqual([
			{ id: 'llama-3.2-3b', loaded: false, contextWindow: 131072 },
			{ id: 'phi-4', loaded: true, contextWindow: 16384 },
		]);
		expect(http.requests.map((r) => new URL(r.url).pathname)).toEqual(['/api/v1/models', '/api/v0/models']);
	});

	it('falls back to the OpenAI-compatible list, and skips unreadable responses', async () => {
		const result = await detectLmStudio(
			server({ '/api/v1/models': () => ({ status: 200, text: '<html>' }), '/v1/models': () => json({ data: [{ id: 'some-model' }] }) }),
			1234,
		);
		expect(result).toEqual({ kind: 'ok', baseUrl: 'http://localhost:1234/v1', models: [{ id: 'some-model', loaded: false }] });
	});

	it('reports an unreachable server, without creating anything (4.3)', async () => {
		const http = new FakeHttp(() => Promise.reject(new Error('ECONNREFUSED')));
		const result = await detectLmStudio(http, 1234);
		expect(result).toEqual({ kind: 'unreachable' });
		expect(detectMessage({ kind: 'unreachable' }, 1234)).toMatch(/^LM Studio isn't reachable at localhost:1234\. Start LM Studio's local server/u);
	});

	it('reports a server with no models (4.0.5)', async () => {
		expect(await detectLmStudio(server({ '/api/v1/models': () => json({ models: [] }) }), 1234)).toEqual({ kind: 'no-models' });
		expect(await detectLmStudio(server({}), 1234)).toEqual({ kind: 'no-models' });
		expect(detectMessage({ kind: 'no-models' }, 1234)).toMatch(/load a model/u);
	});

	it('asks for a token on 401, then succeeds with it (4.5)', async () => {
		const http = server({
			'/api/v1/models': (r) => (r.headers.authorization === 'Bearer good-token' ? json(v1Models) : { status: 401, text: '{"error":"Unauthorized"}' }),
		});
		const first = await detectLmStudio(http, 1234);
		expect(first).toEqual({ kind: 'auth-required', tokenRejected: false });
		expect(http.requests[0]?.headers).toEqual({});
		expect(detectMessage({ kind: 'auth-required', tokenRejected: false }, 1234)).toContain('Developer → Server Settings → Manage Tokens');

		const second = await detectLmStudio(http, 1234, 'good-token');
		expect(second.kind).toBe('ok');
		expect(http.requests[1]?.headers).toEqual({ authorization: 'Bearer good-token' });
	});

	it('reports a rejected token as an authentication problem, not as unreachable (4.6)', async () => {
		const http = server({ '/api/v1/models': () => ({ status: 403, text: '' }) });
		const result = await detectLmStudio(http, 1234, 'bad-token');
		expect(result).toEqual({ kind: 'auth-required', tokenRejected: true });
		const message = detectMessage({ kind: 'auth-required', tokenRejected: true }, 1234);
		expect(message).toMatch(/didn't accept that API token/u);
		expect(message).toContain('Developer → Server Settings → Manage Tokens');
		expect(message).not.toMatch(/reachable/u);
	});
});

describe('upsertLmStudioEngine', () => {
	const model = { id: 'qwen/qwen3-8b', contextWindow: 8192, loaded: true };
	const choice = { port: 1234, baseUrl: 'http://localhost:1234/v1', model, newId: 'new-id' };

	it('creates an engine with the reported context window (3.7)', () => {
		const { engines, engine, created } = upsertLmStudioEngine([], choice);
		expect(created).toBe(true);
		expect(engines).toEqual([engine]);
		expect(engine).toEqual({
			id: 'new-id',
			name: 'LM Studio',
			provider: 'openai-compatible',
			baseUrl: 'http://localhost:1234/v1',
			model: 'qwen/qwen3-8b',
			contextWindow: 8192,
			contextWindowSource: 'reported',
			lmStudio: { port: 1234 },
		});
	});

	it('updates the existing engine instead of adding a duplicate (4.4)', () => {
		const existing: EngineConfig = { id: 'lms', name: 'My local model', provider: 'openai-compatible', model: 'old', baseUrl: 'x', lmStudio: { port: 1234 } };
		const other: EngineConfig = { id: 'claude', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-5-5' };
		const { engines, created } = upsertLmStudioEngine([other, existing], { ...choice, secretId: 'lm-studio-token' });
		expect(created).toBe(false);
		expect(engines).toHaveLength(2);
		expect(engines[1]).toEqual({ ...existing, baseUrl: 'http://localhost:1234/v1', model: 'qwen/qwen3-8b', secretId: 'lm-studio-token', contextWindow: 8192, contextWindowSource: 'reported' });
		expect(existing.model).toBe('old');
	});

	it('keeps a context window the user typed, and clears a stale reported one', () => {
		const userSet: EngineConfig = { id: 'lms', name: 'L', provider: 'openai-compatible', model: 'm', contextWindow: 4000, contextWindowSource: 'user', lmStudio: { port: 1234 } };
		expect(upsertLmStudioEngine([userSet], choice).engine.contextWindow).toBe(4000);
		const reported: EngineConfig = { ...userSet, contextWindowSource: 'reported' };
		const engine = upsertLmStudioEngine([reported], { ...choice, model: { id: 'no-window' } }).engine;
		expect(engine.contextWindow).toBeUndefined();
		expect(engine.contextWindowSource).toBeUndefined();
	});
});
