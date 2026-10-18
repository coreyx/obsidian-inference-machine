import type { EngineConfig } from '../core/schema';
import { uniqueName } from '../core/templates';
import { dig, list } from './base';
import type { ModelInfo } from './engine';
import type { Http, HttpResponse } from './transport';

/**
 * LM Studio auto-detection (REQ-4). Detection uses `requestUrl`, so it works
 * whether or not LM Studio's CORS setting is on (tech.md). It asks LM
 * Studio's native REST API first, because only that reports which models
 * are loaded and their context lengths, and falls back across API versions
 * for older installs:
 *
 * 1. `/api/v1/models` (LM Studio 0.4.0 and later)
 * 2. `/api/v0/models` (LM Studio 0.3.6 and later)
 * 3. `/v1/models`, the OpenAI-compatible list, which has model IDs only
 */

/** What detection found. */
export type DetectResult =
	| { kind: 'ok'; baseUrl: string; models: ModelInfo[]; loadedModelId?: string }
	| { kind: 'unreachable' }
	| { kind: 'no-models' }
	/** LM Studio's "Require authentication" is on (4.0.7). `tokenRejected` is true when a token was sent and refused. */
	| { kind: 'auth-required'; tokenRejected: boolean };

const PROBES = ['/api/v1/models', '/api/v0/models', '/v1/models'] as const;

/** Model types that can't generate text, so an engine can't use them. LM Studio's v1 API also lists `decision` models. */
const NON_CHAT_TYPES = new Set(['embedding', 'embeddings', 'decision']);

/** Reads models from any of the three APIs' response shapes. */
function readModels(response: unknown): ModelInfo[] {
	const entries = [...list(dig(response, 'models')), ...list(dig(response, 'data'))];
	return entries.flatMap((entry) => {
		const id = dig(entry, 'key') ?? dig(entry, 'id');
		const type = dig(entry, 'type');
		if (typeof id !== 'string' || (typeof type === 'string' && NON_CHAT_TYPES.has(type))) return [];
		const instances = list(dig(entry, 'loaded_instances'));
		const loaded = instances.length > 0 || dig(entry, 'state') === 'loaded';
		// A loaded model's actual context length beats the most it could be loaded with (tech.md).
		const contextWindow = [dig(instances[0], 'config', 'context_length'), dig(entry, 'loaded_context_length'), dig(entry, 'max_context_length')].find(
			(value): value is number => typeof value === 'number' && value > 0,
		);
		const info: ModelInfo = { id, loaded };
		const name = dig(entry, 'display_name');
		if (typeof name === 'string') info.name = name;
		if (contextWindow !== undefined) info.contextWindow = contextWindow;
		return [info];
	});
}

/**
 * Probes LM Studio's local server. Every probe is sent first without a
 * token, so a server with authentication off needs no setup. A 401 or 403
 * means authentication is on, which is reported as such and never as
 * "unreachable" (4.0.7).
 */
export async function detectLmStudio(http: Http, port: number, token?: string): Promise<DetectResult> {
	const origin = `http://localhost:${port}`;
	const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
	let reachable = false;
	for (const path of PROBES) {
		let response: HttpResponse;
		try {
			response = await http.request({ url: `${origin}${path}`, method: 'GET', headers });
		} catch {
			continue;
		}
		reachable = true;
		if (response.status === 401 || response.status === 403) return { kind: 'auth-required', tokenRejected: token !== undefined };
		if (response.status >= 400) continue;
		let models: ModelInfo[];
		try {
			models = readModels(JSON.parse(response.text) as unknown);
		} catch {
			continue;
		}
		if (models.length === 0) return { kind: 'no-models' };
		const result: DetectResult = { kind: 'ok', baseUrl: `${origin}/v1`, models };
		const loaded = models.find((model) => model.loaded);
		if (loaded) result.loadedModelId = loaded.id;
		return result;
	}
	return reachable ? { kind: 'no-models' } : { kind: 'unreachable' };
}

/** The message for each unsuccessful detection result (4.0.4, 4.0.5, 4.0.8). */
export function detectMessage(result: Exclude<DetectResult, { kind: 'ok' }>, port: number): string {
	switch (result.kind) {
		case 'unreachable':
			return `LM Studio isn't reachable at localhost:${port}. Start LM Studio's local server (Developer → Start Server), then try again.`;
		case 'no-models':
			return 'LM Studio is running but has no model available. Download or load a model in LM Studio, then try again.';
		case 'auth-required':
			return result.tokenRejected
				? 'LM Studio didn\'t accept that API token. Check it, or create a new one, in LM Studio under Developer → Server Settings → Manage Tokens.'
				: 'LM Studio requires an API token. Create one in LM Studio under Developer → Server Settings → Manage Tokens, then enter it here.';
	}
}

/** What the user chose after a successful detection. */
export interface DetectChoice {
	port: number;
	baseUrl: string;
	model: ModelInfo;
	/** SecretStorage id of the LM Studio token, when authentication is on. */
	secretId?: string;
	/** Used when a new engine is created. */
	newId: string;
}

/**
 * Creates the LM Studio engine, or updates the one detection made before
 * for the same port, so detecting twice never adds a duplicate (4.4). A
 * context window the user typed in is kept; a reported one is refreshed (3.7).
 * A new engine's name is numbered if "LM Studio" is taken, since engine
 * names must be unique.
 */
export function upsertLmStudioEngine(engines: EngineConfig[], choice: DetectChoice): { engines: EngineConfig[]; engine: EngineConfig; created: boolean } {
	const index = engines.findIndex((engine) => engine.lmStudio?.port === choice.port);
	const existing = index === -1 ? undefined : engines[index];
	const engine: EngineConfig = existing
		? { ...existing }
		: {
				id: choice.newId,
				name: uniqueName('LM Studio', engines.map((e) => e.name)),
				provider: 'openai-compatible',
				model: choice.model.id,
				lmStudio: { port: choice.port },
			};
	engine.baseUrl = choice.baseUrl;
	engine.model = choice.model.id;
	if (choice.secretId !== undefined) engine.secretId = choice.secretId;
	if (engine.contextWindowSource !== 'user') {
		if (choice.model.contextWindow !== undefined) {
			engine.contextWindow = choice.model.contextWindow;
			engine.contextWindowSource = 'reported';
		} else {
			delete engine.contextWindow;
			delete engine.contextWindowSource;
		}
	}
	const next = [...engines];
	if (index === -1) next.push(engine);
	else next[index] = engine;
	return { engines: next, engine, created: index === -1 };
}

/** How LM Studio has a model loaded right now (4.0.9). */
export interface LoadedModel {
	/** True when at least one instance of the model is loaded. */
	loaded: boolean;
	/** The context length of the first loaded instance. */
	contextLength?: number;
	/** Every loaded instance of the model, for unloading before a reload. */
	instanceIds: string[];
}

/** The server address for LM Studio's native API, from the engine's OpenAI-compatible base URL. */
export function lmStudioOrigin(engine: EngineConfig): string {
	try {
		return new URL(engine.baseUrl ?? '').origin;
	} catch {
		return `http://localhost:${engine.lmStudio?.port ?? 1234}`;
	}
}

function authHeaders(token: string | undefined): Record<string, string> {
	return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Reads how LM Studio has the engine's model loaded, from the native v1 API.
 * Returns undefined when LM Studio can't be asked (it isn't running, or is
 * older than the v1 API), so callers fall back to the engine's own setting.
 */
export async function readLoadedModel(http: Http, engine: EngineConfig, token?: string): Promise<LoadedModel | undefined> {
	let response: HttpResponse;
	try {
		response = await http.request({ url: `${lmStudioOrigin(engine)}/api/v1/models`, method: 'GET', headers: authHeaders(token) });
	} catch {
		return undefined;
	}
	if (response.status >= 400) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.text) as unknown;
	} catch {
		return undefined;
	}
	const entry = list(dig(parsed, 'models')).find((model) => dig(model, 'key') === engine.model);
	if (!entry) return { loaded: false, instanceIds: [] };
	const instances = list(dig(entry, 'loaded_instances'));
	const contextLength = dig(instances[0], 'config', 'context_length');
	const state: LoadedModel = {
		loaded: instances.length > 0,
		instanceIds: instances.flatMap((instance) => {
			const id = dig(instance, 'id');
			return typeof id === 'string' ? [id] : [];
		}),
	};
	if (typeof contextLength === 'number') state.contextLength = contextLength;
	return state;
}

/**
 * Loads the engine's model with a context length (4.0.10), unloading its
 * current instances first, so LM Studio doesn't end up holding two copies.
 * Throws an Error with LM Studio's own message when the load fails.
 */
export async function loadWithContextLength(http: Http, engine: EngineConfig, contextLength: number, current: LoadedModel, token?: string): Promise<void> {
	const origin = lmStudioOrigin(engine);
	const headers = { 'content-type': 'application/json', ...authHeaders(token) };
	const post = async (path: string, body: unknown, action: string): Promise<void> => {
		let response: HttpResponse;
		try {
			response = await http.request({ url: `${origin}${path}`, method: 'POST', headers, body: JSON.stringify(body) });
		} catch {
			throw new Error(`LM Studio isn't reachable, so it couldn't ${action}.`);
		}
		if (response.status < 400) return;
		let message: unknown;
		try {
			message = dig(JSON.parse(response.text) as unknown, 'error', 'message');
		} catch {
			// Not JSON: report the status alone.
		}
		throw new Error(`LM Studio couldn't ${action} (HTTP ${response.status})${typeof message === 'string' ? `: ${message}` : '.'}`);
	};
	for (const id of current.instanceIds) await post('/api/v1/models/unload', { instance_id: id }, `unload ${engine.model}`);
	await post('/api/v1/models/load', { model: engine.model, context_length: contextLength }, `load ${engine.model} with a ${contextLength.toLocaleString()}-token context`);
}
