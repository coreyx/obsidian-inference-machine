import type { ChatRequest } from './chat';
import { isRecord } from './data-validation';
import { collectPrompts } from './template/knap';

/**
 * Inline prompt variables (REQ-21). Every `{{"…"}}` in a template is
 * answered in one request (21.0.2), following Web Clipper's Interpreter: the
 * prompts are numbered `prompt_1` … `prompt_n`, and the model returns one
 * JSON object with an answer for each. Models, small local ones especially,
 * often return slightly broken JSON, so the parser repairs what it can and
 * falls back to reading each answer on its own.
 */

/** The template fields that may hold inline prompts (21.0.1), in the order they're collected. */
export interface PromptFields {
	noteNameFormat: string;
	propertyValues: string[];
	noteContentFormat: string;
}

/** The distinct prompts in the filename pattern, property values and body wrapper, in order. */
export function collectTemplatePrompts(fields: PromptFields): string[] {
	return collectPrompts([fields.noteNameFormat, ...fields.propertyValues, fields.noteContentFormat]);
}

const INLINE_SYSTEM_PROMPT = [
	'You fill in fields of an Obsidian note, using the source note given as context.',
	'Respond with exactly one JSON object and no other text, in this shape:',
	'{"prompts_responses":{"prompt_1":"answer","prompt_2":"answer"}}',
	'Use exactly the keys you are given, and answer every one.',
	'Each answer is a Markdown string. Keep answers concise and do exactly what each prompt asks.',
	'Answer only from the context. If the context does not contain what a prompt asks for, answer with an empty string rather than guessing.',
].join('\n');

/** Builds the single request that answers every inline prompt. */
export function buildInlineRequest(context: string, prompts: string[]): ChatRequest {
	const numbered: Record<string, string> = {};
	prompts.forEach((prompt, i) => {
		numbered[`prompt_${i + 1}`] = prompt;
	});
	return {
		system: INLINE_SYSTEM_PROMPT,
		user: `${context.trim()}\n\n---\n\nPrompts to answer:\n${JSON.stringify({ prompts: numbered }, null, 2)}`,
	};
}

/** Turns one answer into text: lists become comma-separated, other structures become JSON. */
function answerText(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) return value.map(String).join(', ');
	return JSON.stringify(value, null, 2);
}

/**
 * Repairs common breakage in model-written JSON: literal line breaks and
 * control characters inside strings, curly quotes used as delimiters, and
 * unescaped quotes inside a string. An inner quote is told apart from a
 * closing one by what follows it: a closing quote is followed by `,`, `}`,
 * `]` or `:`.
 */
export function repairJson(text: string): string {
	const normalized = text.replace(/[\u{201C}\u{201D}]/gu, '"');
	let out = '';
	let inString = false;
	for (let i = 0; i < normalized.length; i++) {
		const c = normalized[i]!;
		if (!inString) {
			if (c === '"') inString = true;
			out += c;
			continue;
		}
		if (c === '\\') {
			out += c + (normalized[i + 1] ?? '');
			i++;
		} else if (c === '"') {
			const next = /\S/u.exec(normalized.slice(i + 1))?.[0];
			if (next === undefined || [',', '}', ']', ':'].includes(next)) {
				inString = false;
				out += c;
			} else {
				out += '\\"';
			}
		} else if (c === '\n') {
			out += '\\n';
		} else if (c === '\r') {
			// Dropped: a CRLF line break becomes one \n.
		} else if (c === '\t') {
			out += '\\t';
		} else if (c.charCodeAt(0) < 0x20) {
			// Other control characters have no business in an answer.
		} else {
			out += c;
		}
	}
	return out;
}

/** Parses the first JSON object in a response, repairing it if needed. */
function parseObject(raw: string): Record<string, unknown> | undefined {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start === -1 || end <= start) return undefined;
	const candidate = raw.slice(start, end + 1);
	for (const attempt of [candidate, repairJson(candidate)]) {
		try {
			const parsed: unknown = JSON.parse(attempt);
			if (isRecord(parsed)) return parsed;
		} catch {
			// Try the next attempt.
		}
	}
	return undefined;
}

/** Reads one answer straight out of the text, for JSON too broken to parse as a whole. */
function matchAnswer(raw: string, key: string): string | undefined {
	const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`, 'u').exec(raw);
	if (!match) return undefined;
	try {
		return JSON.parse(`"${match[1] ?? ''}"`) as string;
	} catch {
		return match[1];
	}
}

/**
 * Reads the answers from an inline-prompt response, one per prompt, in
 * prompt order. A prompt the response doesn't answer is `undefined` (21.0.6).
 */
export function parseInlineResponse(raw: string, count: number): (string | undefined)[] {
	const parsed = parseObject(raw);
	const answers = parsed && isRecord(parsed.prompts_responses) ? parsed.prompts_responses : parsed;
	return Array.from({ length: count }, (_, i) => {
		const key = `prompt_${i + 1}`;
		const fromObject = answers ? answerText(answers[key]) : undefined;
		return fromObject ?? matchAnswer(raw, key);
	});
}

/** Pairs prompts with their answers for rendering, and lists the prompts left unanswered. */
export function answerMap(prompts: string[], answers: (string | undefined)[]): { answers: Map<string, string>; unanswered: string[] } {
	const map = new Map<string, string>();
	const unanswered: string[] = [];
	prompts.forEach((prompt, i) => {
		const answer = answers[i];
		if (answer === undefined) unanswered.push(prompt);
		else map.set(prompt, answer);
	});
	return { answers: map, unanswered };
}

/** The notice naming unanswered inline prompts (21.0.6). */
export function unansweredNotice(unanswered: string[]): string | undefined {
	if (unanswered.length === 0) return undefined;
	const names = unanswered.map((prompt) => `"${prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt}"`).join(', ');
	return `No answer came back for ${unanswered.length === 1 ? 'the inline prompt' : 'these inline prompts'} ${names}, so ${unanswered.length === 1 ? 'it was' : 'they were'} left empty.`;
}
