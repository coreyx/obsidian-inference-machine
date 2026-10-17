import { afterEach, describe, expect, it, vi } from 'vitest';
import { obsidianHttp, resetStreamingBlocked, streamWithFallback } from '../../src/engines/transport';
import { requestUrlFixture, type RequestUrlParam } from '../obsidian-stub';
import { FakeHttp } from './fake-http';

afterEach(() => {
	requestUrlFixture.handler = undefined;
	vi.unstubAllGlobals();
});

describe('obsidianHttp', () => {
	it('sends requests through requestUrl without throwing on HTTP errors', async () => {
		const calls: RequestUrlParam[] = [];
		requestUrlFixture.handler = (param) => {
			calls.push(param);
			return { status: 418, text: 'teapot' };
		};
		const response = await obsidianHttp.request({ url: 'https://x.test', method: 'GET', headers: { a: 'b' } });
		expect(response).toEqual({ status: 418, text: 'teapot' });
		expect(calls).toEqual([{ url: 'https://x.test', method: 'GET', headers: { a: 'b' }, throw: false }]);
	});

	it('streams through fetch with the abort signal', async () => {
		const fetchMock = vi.fn(async () => new Response('data: x\n\n', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const signal = new AbortController().signal;
		const response = await obsidianHttp.stream({ url: 'https://x.test', method: 'POST', headers: {}, body: '{}' }, signal);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('data: x\n\n');
		expect(fetchMock).toHaveBeenCalledWith('https://x.test', { method: 'POST', headers: {}, body: '{}', signal });
	});
});

describe('resetStreamingBlocked', () => {
	it('forgets one engine\'s blocked streaming', async () => {
		const http = new FakeHttp();
		const plan = {
			http,
			engineKey: 'e',
			request: { url: 'https://x.test', method: 'POST' as const, headers: {} },
			signal: new AbortController().signal,
			context: { engineName: 'E', url: 'https://x.test' },
			onEvent: () => undefined,
			finish: () => ({ text: '', truncated: false, streamed: true }),
			fallback: async () => ({ text: 'f', truncated: false, streamed: false }),
			blockedHint: 'h',
		};
		await streamWithFallback(plan);
		resetStreamingBlocked('e');
		await streamWithFallback(plan);
		expect(http.streams).toHaveLength(2);
	});
});
