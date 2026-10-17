import type { EngineConfig } from '../core/schema';
import { AnthropicEngine } from './anthropic';
import type { EngineDeps } from './base';
import type { Engine } from './engine';
import { GeminiEngine } from './gemini';
import { OpenAiEngine } from './openai';

/** Builds the client for a saved engine. The request format follows the explicit provider type, never the name or URL (tech.md). */
export function createEngine(config: EngineConfig, deps: EngineDeps): Engine {
	switch (config.provider) {
		case 'anthropic':
			return new AnthropicEngine(config, deps);
		case 'openai':
		case 'openai-compatible':
			return new OpenAiEngine(config, deps);
		case 'gemini':
			return new GeminiEngine(config, deps);
	}
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/iu;

/**
 * Whether an engine runs on this device or this network (18.0.1). Loopback
 * and private-range hosts count as local; every built-in cloud provider, and
 * any other host, is remote.
 */
export function isLocalEngine(config: EngineConfig): boolean {
	if (config.provider !== 'openai-compatible' || !config.baseUrl) return false;
	try {
		return PRIVATE_HOST.test(new URL(config.baseUrl).hostname);
	} catch {
		return false;
	}
}
