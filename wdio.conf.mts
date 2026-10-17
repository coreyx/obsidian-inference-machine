import * as path from 'node:path';
import { startMockLlm } from './test/e2e/mock-llm-server.mjs';

/**
 * End-to-end tests in real Obsidian (TASK-21), through wdio-obsidian-service.
 * Two mock OpenAI-compatible servers stand in for a model: one allows
 * cross-origin requests, so streaming is used; the other doesn't, so the
 * plugin's requestUrl fallback is exercised.
 */
export const MOCK_PORT = 4891;
export const MOCK_NO_CORS_PORT = 4892;

const cacheDir = path.resolve('.obsidian-cache');
const servers: { stop(): Promise<void> }[] = [];

const obsidian = (appVersion: string, installerVersion: string, extra: Record<string, unknown> = {}) => ({
	browserName: 'obsidian',
	browserVersion: appVersion,
	'wdio:obsidianOptions': { installerVersion, plugins: ['.'], vault: 'test/vault', ...extra },
});

export const config: WebdriverIO.Config = {
	runner: 'local',
	framework: 'mocha',
	specs: ['./test/e2e/specs/**/*.e2e.ts'],
	maxInstances: 1,
	capabilities: [
		obsidian('latest', 'latest'),
		// The plugin's minAppVersion, where SecretStorage first appeared.
		obsidian('earliest', 'earliest'),
		{
			...obsidian('latest', 'latest', { emulateMobile: true }),
			'goog:chromeOptions': { mobileEmulation: { deviceMetrics: { width: 390, height: 844 } } },
		},
	],
	services: ['obsidian'],
	reporters: ['obsidian'],
	cacheDir,
	mochaOpts: { ui: 'bdd', timeout: 60000 },
	logLevel: 'warn',
	async onPrepare() {
		servers.push(await startMockLlm({ port: MOCK_PORT, cors: true }));
		servers.push(await startMockLlm({ port: MOCK_NO_CORS_PORT, cors: false }));
	},
	async onComplete() {
		await Promise.all(servers.map((s) => s.stop()));
	},
};
