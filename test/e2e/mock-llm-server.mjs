// A stand-in OpenAI-compatible server for end-to-end tests. It answers chat
// completions with canned replies (streamed as SSE when asked), recognizes
// the plugin's inline-prompt and tagging requests and replies in their JSON
// shapes, records every request, and can run with CORS on or off so both
// the streaming path and the requestUrl fallback are exercised.
//
// Usage: node test/e2e/mock-llm-server.mjs [port] [--no-cors]
// Or import { startMockLlm } from it.
import http from 'node:http';

/** The main reply: a short summary with the sections a summary template asks for. */
export const MAIN_REPLY = '## Summary\nThe team plans to ship the beta next week.\n\n## Key points\n- The beta ships next week.\n- Ada leads the launch.';

function replyFor(body) {
	const system = body.messages?.find((m) => m.role === 'system')?.content ?? '';
	const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
	if (system.includes('prompts_responses')) {
		const marker = 'Prompts to answer:\n';
		const prompts = JSON.parse(user.slice(user.lastIndexOf(marker) + marker.length)).prompts;
		const answers = Object.fromEntries(Object.keys(prompts).map((key, i) => [key, `Answer ${i + 1}`]));
		return JSON.stringify({ prompts_responses: answers });
	}
	if (system.includes('suggest tags')) return JSON.stringify({ tags: ['launch-planning', 'beta'] });
	return MAIN_REPLY;
}

/**
 * Starts the server. Resolves with its URL, the requests it has received,
 * and a function that stops it.
 */
export function startMockLlm({ port = 0, cors = true } = {}) {
	const requests = [];
	const corsHeaders = cors
		? { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
		: {};
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => (raw += chunk));
		req.on('end', () => {
			if (req.method === 'OPTIONS') {
				res.writeHead(cors ? 204 : 405, corsHeaders);
				res.end();
				return;
			}
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname === '/__requests') {
				res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
				res.end(JSON.stringify(requests));
				return;
			}
			const body = raw ? JSON.parse(raw) : {};
			requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });
			if (req.method === 'GET' && url.pathname.endsWith('/models')) {
				res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
				res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
				return;
			}
			if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
				res.writeHead(404, corsHeaders);
				res.end('Not found');
				return;
			}
			const reply = replyFor(body);
			if (body.stream) {
				res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...corsHeaders });
				const pieces = reply.match(/[\s\S]{1,12}/g) ?? [];
				let i = 0;
				const timer = setInterval(() => {
					if (i < pieces.length) {
						res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] })}\n\n`);
					} else {
						clearInterval(timer);
						res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
						res.end('data: [DONE]\n\n');
					}
				}, 20);
				return;
			}
			res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
			res.end(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }));
		});
	});
	return new Promise((resolve) => {
		server.listen(port, '127.0.0.1', () => {
			const { port: actual } = server.address();
			resolve({ url: `http://127.0.0.1:${actual}/v1`, requests, stop: () => new Promise((r) => server.close(r)) });
		});
	});
}

if (process.argv[1]?.endsWith('mock-llm-server.mjs')) {
	const port = Number(process.argv[2] ?? 4891);
	const { url } = await startMockLlm({ port, cors: !process.argv.includes('--no-cors') });
	console.log(`Mock LLM listening at ${url}`);
}
