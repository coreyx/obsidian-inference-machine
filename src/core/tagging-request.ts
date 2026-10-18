import type { ChatRequest, ChatResult } from './chat';
import { isRecord } from './data-validation';
import type { NoteSnapshot } from './note';
import { stripReasoning } from './reasoning';
import type { ResolvedTagging } from './resolve';
import type { TagFormat } from './schema';

/**
 * The AI tagging request (REQ-14). It's separate from the main request and
 * reads the source note, not the main output (14.0.2), so it can run at the
 * same time. The plugin, not the model, has the final say: the tags that
 * come back still go through the tag pipeline for dedup, format, validity
 * and the cap (12.0.5).
 */

/** The most vault tags sent with a request (14.0.3). */
export const MAX_VAULT_TAGS = 1000;

/** What the request is built from. */
export interface TaggingRequestInput {
	note: NoteSnapshot;
	settings: ResolvedTagging;
	/** The vault's tags, most used first. Sent only when reuse is on (14.0.3). */
	vaultTags: readonly string[];
	/** The vault's group prefixes, such as `ai/`. Sent only when hierarchical prefixes are on (14.0.7). */
	prefixes: readonly string[];
}

const SYSTEM_PROMPT = [
	'You suggest tags for an Obsidian note.',
	'Respond with one JSON object and no other text, in this shape: {"tags": ["first-tag", "second-tag"]}',
	'Each tag is a short topic label without a leading #.',
].join('\n');

/** How each named format is described to the model (13.0.2). */
function formatInstruction(format: TagFormat): string {
	if (typeof format === 'object') return `Write each tag in this format: ${format.custom}`;
	switch (format) {
		case 'kebab':
			return 'Write each tag in kebab-case: lowercase words joined by hyphens, like machine-learning.';
		case 'snake':
			return 'Write each tag in snake_case: lowercase words joined by underscores, like machine_learning.';
		case 'camel':
			return 'Write each tag in camelCase: words joined together, each after the first capitalized, like machineLearning.';
		case 'pascal':
			return 'Write each tag in PascalCase: words joined together, each capitalized, like MachineLearning.';
	}
}

/** Builds the tagging request from the source note and the resolved tagging settings. */
export function buildTaggingRequest(input: TaggingRequestInput): ChatRequest {
	const { settings, note } = input;
	const rules: string[] = [
		`Suggest between ${settings.minTags} and ${settings.maxTags} tags that describe what the note is about.`,
		formatInstruction(settings.format),
		'Tags can\'t contain spaces, and must contain at least one letter.',
	];

	const vaultTags = settings.reuseVaultTags ? input.vaultTags.slice(0, MAX_VAULT_TAGS) : [];
	if (settings.existingOnly) {
		rules.push('Use only tags from the list of existing tags below. Don\'t create new tags.');
	} else if (vaultTags.length > 0) {
		rules.push('Reuse an existing tag from the list below whenever one fits the note, before creating a new one, and keep its exact spelling.');
	}

	if (settings.hierarchicalPrefixes) {
		if (input.prefixes.length > 0) {
			rules.push(
				`Tags can be grouped with a prefix and a slash. The vault already uses these prefixes: ${input.prefixes.join(', ')}. Reuse one of them first when a tag belongs to its group, as in ${input.prefixes[0]}example. Create a new prefix only when none fits and the new prefix groups tags in a meaningful way.`,
			);
		} else {
			rules.push('Tags can be grouped with a prefix and a slash, as in topic/subtopic, but only when the grouping is meaningful.');
		}
	} else {
		rules.push('Return flat tags only: don\'t use / in any tag.');
	}

	if (settings.preferredTags.length > 0) rules.push(`Favor these tags when they fit the note: ${settings.preferredTags.join(', ')}.`);
	const existing = [...note.frontmatterTags, ...note.inlineTags];
	if (settings.mergeSourceTags && existing.length > 0) rules.push(`The note already has these tags, so don't suggest them again: ${existing.join(', ')}.`);

	const sections = [`Rules:\n${rules.map((rule) => `- ${rule}`).join('\n')}`];
	if (vaultTags.length > 0) sections.push(`Existing tags in this vault, most used first:\n${vaultTags.join('\n')}`);
	sections.push(`The note, "${note.title}":\n\n${note.content}`);
	return { system: SYSTEM_PROMPT, user: sections.join('\n\n---\n\n') };
}

/** Removes list markers, quotes and `#` from one line of a plain-text tag list. */
function cleanItem(item: string): string {
	return item
		.trim()
		.replace(/^(?:[-*•]|\d+[.)])\s+/u, '')
		.replace(/^["'`]+|["'`,]+$/gu, '')
		.replace(/^#/u, '')
		.trim();
}

/** Reads the tags from a JSON value: `{"tags": [...]}`, or a bare array. */
function tagsFromJson(value: unknown): string[] | undefined {
	const list = isRecord(value) ? value.tags : value;
	if (Array.isArray(list)) return list.filter((item): item is string => typeof item === 'string').map(cleanItem).filter((t) => t !== '');
	if (typeof list === 'string') return list.split(',').map(cleanItem).filter((t) => t !== '');
	return undefined;
}

/**
 * Reads the tags from a tagging response: a JSON object or array anywhere in
 * the text, or, from a model that ignored the format, a comma- or
 * line-separated list.
 */
export function parseTaggingResponse(raw: string): string[] {
	const text = raw.trim().replace(/^```\w*\n?|\n?```$/gu, '');
	for (const [open, close] of [
		['{', '}'],
		['[', ']'],
	] as const) {
		const start = text.indexOf(open);
		const end = text.lastIndexOf(close);
		if (start === -1 || end <= start) continue;
		try {
			const tags = tagsFromJson(JSON.parse(text.slice(start, end + 1)) as unknown);
			if (tags) return tags;
		} catch {
			// Not JSON; try the next shape.
		}
	}
	return text
		.split(/[\n,]+/u)
		.map(cleanItem)
		.filter((tag) => tag !== '' && !/\s{2,}|[:{}[\]]/u.test(tag) && tag.split(/\s+/u).length <= 4);
}

/** The outcome of a tagging request: tags, or a notice explaining why there are none (14.0.9). */
export interface AiTagsResult {
	tags: string[];
	notice?: string;
}

/**
 * Sends the tagging request. A failed request, or one that returns nothing
 * usable, never fails the run: the note is produced without AI tags, and a
 * notice says why (14.0.9).
 */
export async function requestAiTags(
	complete: (request: ChatRequest, options: { json: boolean }) => Promise<ChatResult>,
	request: ChatRequest,
): Promise<AiTagsResult> {
	try {
		const result = await complete(request, { json: true });
		const tags = parseTaggingResponse(stripReasoning(result.text));
		if (tags.length === 0 && result.truncated) {
			return { tags, notice: `AI tagging used the engine's whole output limit before suggesting any tags, which usually means a reasoning model spent it all reasoning, so the note has no AI tags. Raise the engine's maximum output tokens, or leave it empty to use the model's own limit.` };
		}
		if (tags.length === 0) return { tags, notice: 'AI tagging returned no usable tags, so the note has no AI tags.' };
		return { tags };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { tags: [], notice: `AI tagging failed, so the note has no AI tags. ${reason}` };
	}
}
