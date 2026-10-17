import { beforeEach, describe, expect, it } from 'vitest';
import { NormalizedError, redact } from '../../src/engines/engine';
import { SseParser } from '../../src/engines/sse';
import {
	httpError,
	networkError,
	requestJson,
	resetStreamingBlocked,
	streamWithFallback,
	type StreamPlan,
} from '../../src/engines/transport';
import { chunkedBody, FakeHttp, json, sseResponse } from './fake-http';

const context = { engineName: 'Claude', url: 'https://api.anthropic.com/v1/messages', secret: 'sk-ant-SECRET-1234' };
const request = { url: context.url, method: 'POST' as const, headers: {}, body: '{}' };

describe('SseParser', () => {
	it('parses events split across arbitrary chunk boundaries', () => {
		const stream = 'event: delta\ndata: {"a":1}\n\n: keep-alive\n\ndata: line one\ndata: line two\n\ndata: [DONE]\n\n';
		for (let size = 1; size <= stream.length; size++) {
			const parser = new SseParser();
			const events = [];
			for (let i = 0; i < stream.length; i += size) events.push(...parser.push(stream.slice(i, i + size)));
			events.push(...parser.end());
			expect(events, `chunk size ${size}`).toEqual([
				{ event: 'delta', data: '{"a":1}' },
				{ data: 'line one\nline two' },
				{ data: '[DONE]' },
			]);
		}
	});

	it('handles CRLF and CR line endings, a CR split from its LF, and fields without a value', () => {
		const parser = new SseParser();
		expect([...parser.push('data: a\r'), ...parser.push('\n\r\ndata: b\r\rdata\n\n')]).toEqual([{ data: 'a' }, { data: 'b' }, { data: '' }]);
	});

	it('keeps a UTF-8 character that is split between chunks', () => {
		const bytes = new TextEncoder().encode('data: café ☕\n\n');
		const parser = new SseParser();
		const events = [...parser.push(bytes.slice(0, 10)), ...parser.push(bytes.slice(10))];
		expect(events).toEqual([{ data: 'café ☕' }]);
	});

	it('dispatches a final event that has no trailing blank line', () => {
		const parser = new SseParser();
		expect(parser.push('data: last')).toEqual([]);
		expect(parser.end()).toEqual([{ data: 'last' }]);
	});
});

describe('httpError (3.4, 18.2)', () => {
	it('maps statuses to kinds', () => {
		expect(httpError(401, '', context).kind).toBe('auth');
		expect(httpError(403, '', context).kind).toBe('auth');
		expect(httpError(429, '', context).kind).toBe('rate-limit');
		expect(httpError(404, '', context).kind).toBe('not-found');
		expect(httpError(500, 'oops', context).kind).toBe('provider');
		expect(httpError(400, '{"error":{"message":"prompt is too long: 250000 tokens"}}', context).kind).toBe('context-length');
	});

	it('gives a readable authentication message with no key in it', () => {
		const body = JSON.stringify({ error: { type: 'authentication_error', message: `invalid x-api-key ${context.secret}` } });
		const error = httpError(401, body, context);
		expect(error.message).toBe(
			'Claude didn\'t accept the credentials (HTTP 401). Check the API key in this engine\'s settings. The provider said: invalid x-api-key ***',
		);
		expect(error.message).not.toContain(context.secret);
		expect(error.status).toBe(401);
	});

	it('reads provider messages in each provider\'s error shape', () => {
		expect(httpError(500, '{"error":"plain string"}', context).message).toContain('plain string');
		expect(httpError(500, '{"message":"top level"}', context).message).toContain('top level');
		expect(httpError(500, '[{"error":{"message":"gemini array"}}]', context).message).toContain('gemini array');
		expect(httpError(500, '<html>Bad gateway</html>', context).message).toContain('<html>Bad gateway</html>');
		expect(httpError(500, '   ', context).message).toBe('Claude returned an error (HTTP 500).');
		expect(httpError(500, '[1]', context).message).toContain('[1]');
	});

	it('names the host when the network fails', () => {
		expect(networkError(context).message).toMatch(/^Couldn't reach Claude at api\.anthropic\.com\./u);
		expect(networkError({ engineName: 'X', url: 'not a url' }).message).toContain('at not a url.');
	});
});

describe('redact (18.0.3)', () => {
	it('replaces the secret everywhere and ignores trivially short secrets', () => {
		expect(redact('a SECRET b SECRET', 'SECRET')).toBe('a *** b ***');
		expect(redact('abc', 'ab')).toBe('abc');
		expect(redact('abc', undefined)).toBe('abc');
	});
});

describe('requestJson', () => {
	it('parses a JSON reply', async () => {
		expect(await requestJson(new FakeHttp(() => json({ ok: true })), request, context)).toEqual({ ok: true });
	});

	it('normalizes network failures, HTTP errors, empty and non-JSON replies', async () => {
		const cases: [FakeHttp, string][] = [
			[new FakeHttp(() => Promise.reject(new Error('ECONNREFUSED'))), 'network'],
			[new FakeHttp(() => ({ status: 401, text: '' })), 'auth'],
			[new FakeHttp(() => ({ status: 200, text: '  ' })), 'empty'],
			[new FakeHttp(() => ({ status: 200, text: 'not json' })), 'provider'],
		];
		for (const [http, kind] of cases) {
			await expect(requestJson(http, request, context)).rejects.toMatchObject({ kind });
		}
	});
});

describe('streamWithFallback (design decision 6)', () => {
	beforeEach(() => resetStreamingBlocked());

	function plan(http: FakeHttp, overrides: Partial<StreamPlan> = {}) {
		let text = '';
		const p: StreamPlan = {
			http,
			engineKey: 'engine-1',
			request,
			signal: new AbortController().signal,
			context,
			onEvent: (event) => {
				if (event.data === '[DONE]') return true;
				text += event.data;
				return undefined;
			},
			finish: () => ({ text, truncated: false, streamed: true }),
			fallback: async () => ({ text: 'fallback', truncated: false, streamed: false }),
			blockedHint: 'Streaming is blocked.',
			...overrides,
		};
		return p;
	}

	it('streams events until the stream says it is done', async () => {
		const http = new FakeHttp(undefined, () => sseResponse(['data: Hel', 'lo\n\ndata: , world\n\n', 'data: [DONE]\n\n', 'data: ignored\n\n']));
		expect(await streamWithFallback(plan(http))).toEqual({ text: 'Hello, world', truncated: false, streamed: true });
	});

	it('finishes when the stream ends without a done event', async () => {
		const http = new FakeHttp(undefined, () => sseResponse(['data: a\n\n', 'data: b']));
		expect((await streamWithFallback(plan(http))).text).toBe('ab');
	});

	it('falls back once on a TypeError, then skips streaming for that engine', async () => {
		const http = new FakeHttp();
		expect(await streamWithFallback(plan(http))).toEqual({ text: 'fallback', truncated: false, streamed: false, notice: 'Streaming is blocked.' });
		// Second run: straight to the fallback, no second fetch, and no repeated hint.
		expect(await streamWithFallback(plan(http))).toEqual({ text: 'fallback', truncated: false, streamed: false });
		expect(http.streams).toHaveLength(1);
		// Another engine still tries streaming.
		await streamWithFallback(plan(http, { engineKey: 'engine-2' }));
		expect(http.streams).toHaveLength(2);
	});

	it('never falls back on an HTTP error', async () => {
		const http = new FakeHttp(undefined, () => sseResponse(['{"error":{"message":"overloaded"}}'], 500));
		const error = await streamWithFallback(plan(http)).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NormalizedError);
		expect(error).toMatchObject({ kind: 'provider', status: 500 });
	});

	it('reports other failures before a response as network errors', async () => {
		const http = new FakeHttp(undefined, () => Promise.reject(new Error('boom')));
		await expect(streamWithFallback(plan(http))).rejects.toMatchObject({ kind: 'network' });
	});

	it('uses the fallback when the response has no body', async () => {
		const http = new FakeHttp(undefined, () => ({ status: 200, body: null, text: async () => '' }));
		expect((await streamWithFallback(plan(http))).text).toBe('fallback');
	});

	it('reports a cancelled run, before and during the stream', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(streamWithFallback(plan(new FakeHttp(), { signal: controller.signal }))).rejects.toMatchObject({ kind: 'cancelled' });

		const midStream = new AbortController();
		const http = new FakeHttp(undefined, () => ({
			status: 200,
			text: async () => '',
			body: new ReadableStream({
				pull() {
					midStream.abort();
					throw new DOMException('aborted', 'AbortError');
				},
			}),
		}));
		await expect(streamWithFallback(plan(http, { signal: midStream.signal }))).rejects.toMatchObject({ kind: 'cancelled' });

		const rejected = new AbortController();
		const blocked = new FakeHttp(undefined, () => {
			rejected.abort();
			throw new DOMException('aborted', 'AbortError');
		});
		await expect(streamWithFallback(plan(blocked, { signal: rejected.signal }))).rejects.toMatchObject({ kind: 'cancelled' });
	});

	it('reports a dropped connection mid-stream as a network error, and passes engine errors through', async () => {
		const dropped = new FakeHttp(undefined, () => ({
			status: 200,
			text: async () => '',
			body: new ReadableStream({
				pull() {
					throw new TypeError('network error');
				},
			}),
		}));
		await expect(streamWithFallback(plan(dropped))).rejects.toMatchObject({ kind: 'network' });

		const http = new FakeHttp(undefined, () => ({ status: 200, text: async () => '', body: chunkedBody(['data: x\n\n']) }));
		const failing = plan(http, {
			onEvent: () => {
				throw new NormalizedError('provider', 'stream error event');
			},
		});
		await expect(streamWithFallback(failing)).rejects.toMatchObject({ kind: 'provider', message: 'stream error event' });
	});
});
