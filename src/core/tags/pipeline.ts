import type { TaggingSettings } from '../schema';
import { formatTag } from './format';
import { stripHash, tagFold, tagKey } from './normalize';
import { makeTagValid } from './validate';

/**
 * Builds the output note's tag list (REQ-11 to REQ-14). The model never
 * dedups or validates tags: the plugin does, here (12.0.5), so the result is
 * the same whichever model produced the AI tags.
 */

/** The settings the pipeline reads. */
export type TagPipelineSettings = Pick<
	TaggingSettings,
	'mergeSourceTags' | 'format' | 'applyFormatToSource' | 'hierarchicalPrefixes' | 'existingOnly' | 'maxTags'
>;

/** Everything the pipeline combines. */
export interface TagPipelineInput {
	/** The source note's frontmatter `tags`, in order. */
	sourceFrontmatter: string[];
	/** The source note's inline `#tags`, in order of appearance. */
	sourceInline: string[];
	/** Tags from the template's own `tags` property. */
	template: string[];
	/** Tags from AI tagging and from any frontmatter in the AI output. */
	ai: string[];
	/** Tags already in the vault, most used first. Used for reuse and "existing tags only". */
	vaultTags: readonly string[];
	settings: TagPipelineSettings;
}

/** A tag left out of the output, and why, for the preview's warnings (13.0.5). */
export interface DroppedTag {
	tag: string;
	reason: 'invalid' | 'not-in-vault';
}

/** The final tags and what was dropped on the way. */
export interface TagPipelineResult {
	tags: string[];
	dropped: DroppedTag[];
}

/**
 * Where a candidate came from, in order of spelling precedence (12.0.3):
 * source frontmatter, source inline, template, a vault tag the AI reused,
 * then nested AI tags over flat ones.
 */
const Origin = {
	Frontmatter: 0,
	Inline: 1,
	Template: 2,
	Vault: 3,
	AiNested: 4,
	AiFlat: 5,
} as const;
type Origin = (typeof Origin)[keyof typeof Origin];

interface Candidate {
	tag: string;
	origin: Origin;
	/** Position within its group, for "first occurrence first". */
	index: number;
}

/** Output order groups (11.0.2): frontmatter, inline, template, then every AI-contributed tag. */
function group(origin: Origin): number {
	return Math.min(origin, Origin.Vault);
}

/** Finds a vault tag equivalent to `tag`, by key or ignoring case. The most-used spelling wins. */
function vaultLookup(vaultTags: readonly string[]): (tag: string) => string | undefined {
	const byKey = new Map<string, string>();
	const byFold = new Map<string, string>();
	for (const spelling of vaultTags) {
		const bare = stripHash(spelling);
		if (!byKey.has(tagKey(bare))) byKey.set(tagKey(bare), bare);
		if (!byFold.has(tagFold(bare))) byFold.set(tagFold(bare), bare);
	}
	return (tag) => byFold.get(tagFold(tag)) ?? byKey.get(tagKey(tag));
}

/**
 * Step 2: prepares AI tags. Drops tags not in the vault when "existing tags
 * only" is on (14.0.5); flattens nesting when hierarchical prefixes are off
 * (14.0.7); then reuses the vault's spelling of an equivalent tag (13.0.6)
 * or converts the tag to the resolved format (13.0.3).
 */
function prepareAiTags(input: TagPipelineInput, dropped: DroppedTag[]): Candidate[] {
	const { settings } = input;
	const findInVault = vaultLookup(input.vaultTags);
	const prepared: Candidate[] = [];
	input.ai.forEach((raw, index) => {
		const bare = stripHash(raw).trim();
		if (bare === '') return;
		const flat = settings.hierarchicalPrefixes ? bare : bare.replace(/\/+/gu, ' ');
		const vaultSpelling = findInVault(flat);
		if (settings.existingOnly && vaultSpelling === undefined) {
			dropped.push({ tag: raw, reason: 'not-in-vault' });
			return;
		}
		// A nested vault spelling can't be reused when the user asked for flat tags.
		if (vaultSpelling !== undefined && (settings.hierarchicalPrefixes || !vaultSpelling.includes('/'))) {
			prepared.push({ tag: vaultSpelling, origin: Origin.Vault, index });
			return;
		}
		const tag = formatTag(flat, settings.format);
		prepared.push({ tag, origin: tag.includes('/') ? Origin.AiNested : Origin.AiFlat, index });
	});
	return prepared;
}

/**
 * Groups equivalent candidates (same key, or same ignoring case) with a
 * union-find over both labels, so `DevOps`, `devops` and `dev-ops` land in
 * one group even though no single label links all three.
 */
function groupEquivalent(candidates: Candidate[]): Candidate[][] {
	const parent = candidates.map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]!]!;
			i = parent[i]!;
		}
		return i;
	};
	const firstWithLabel = new Map<string, number>();
	candidates.forEach((candidate, i) => {
		for (const label of labels(candidate)) {
			const other = firstWithLabel.get(label);
			if (other === undefined) firstWithLabel.set(label, i);
			else parent[find(i)] = find(other);
		}
	});
	const groups = new Map<number, Candidate[]>();
	candidates.forEach((candidate, i) => {
		const root = find(i);
		const members = groups.get(root) ?? [];
		members.push(candidate);
		groups.set(root, members);
	});
	return [...groups.values()];
}

/** The two labels a tag is matched by: its key, and its case-folded spelling. */
function labels(candidate: Candidate): string[] {
	return [`key:${tagKey(candidate.tag)}`, `fold:${tagFold(candidate.tag)}`];
}

/**
 * Steps 5 and 6's grouping. Source and template tags are grouped among
 * themselves first. Each AI tag then joins at most one of those groups (the
 * earliest it matches), so an AI tag can never merge two source tags that
 * aren't equivalent to each other: `DevOps` matches both `Devops` (by case)
 * and `dev-ops` (by key), but mustn't make either of them disappear.
 */
function dedupGroups(own: Candidate[], ai: Candidate[]): Candidate[][] {
	const ownGroups = groupEquivalent(own).sort((a, b) => byPosition(earliest(a), earliest(b)));
	const groupByLabel = new Map<string, number>();
	ownGroups.forEach((members, index) => {
		for (const member of members) {
			for (const label of labels(member)) if (!groupByLabel.has(label)) groupByLabel.set(label, index);
		}
	});
	const unmatched: Candidate[] = [];
	for (const candidate of ai) {
		const hits = labels(candidate)
			.map((label) => groupByLabel.get(label))
			.filter((index): index is number => index !== undefined);
		if (hits.length > 0) ownGroups[Math.min(...hits)]!.push(candidate);
		else unmatched.push(candidate);
	}
	return [...ownGroups, ...groupEquivalent(unmatched)];
}

/** The member of a group that decides where the group sits in the output. */
function earliest(members: Candidate[]): Candidate {
	return [...members].sort(byPosition)[0]!;
}

/** Orders candidates by spelling precedence, then by first occurrence. */
function byPrecedence(a: Candidate, b: Candidate): number {
	return a.origin - b.origin || a.index - b.index;
}

/** Orders candidates by output position: group, then first occurrence. */
function byPosition(a: Candidate, b: Candidate): number {
	return group(a.origin) - group(b.origin) || a.index - b.index;
}

/** Runs the seven-step tag pipeline in design.md and returns the output note's tags. */
export function buildTags(input: TagPipelineInput): TagPipelineResult {
	const { settings } = input;
	const dropped: DroppedTag[] = [];

	// 1. Collect. Source tags only count when merging is on (11.0.1).
	const source: Candidate[] = settings.mergeSourceTags
		? [
				...input.sourceFrontmatter.map((tag, index) => ({ tag, origin: Origin.Frontmatter, index })),
				...input.sourceInline.map((tag, index) => ({ tag, origin: Origin.Inline, index })),
			]
		: [];
	const template = input.template.map((tag, index) => ({ tag, origin: Origin.Template, index }));

	// 2. Prepare AI tags.
	const ai = prepareAiTags(input, dropped);

	// 3. Source and template tags keep their spelling unless the user asked otherwise (11.0.3, 13.0.6).
	const ownTags = [...source, ...template].map((c) => ({
		...c,
		tag: settings.applyFormatToSource ? formatTag(c.tag, settings.format) : stripHash(c.tag),
	}));

	// 4. Make every tag valid, recording any that can't be.
	const makeValid = (candidates: Candidate[]): Candidate[] =>
		candidates.flatMap((candidate) => {
			const result = makeTagValid(candidate.tag, settings.format);
			if (result.ok) return [{ ...candidate, tag: result.tag }];
			dropped.push({ tag: candidate.tag, reason: 'invalid' });
			return [];
		});
	const validOwn = makeValid(ownTags);
	const validAi = makeValid(ai);

	// 5. Dedup: one spelling per group of equivalent tags, by precedence (12.0.3).
	// 6. Order: each group sits where its earliest member would (11.0.2).
	const merged = dedupGroups(validOwn, validAi)
		.map((members) => ({
			tag: [...members].sort(byPrecedence)[0]!.tag,
			position: earliest(members),
			fromAiOnly: members.every((m) => group(m.origin) === Origin.Vault),
		}))
		.sort((a, b) => byPosition(a.position, b.position));

	// 7. Cap the AI-contributed tags, counted after dedup against source and template tags (14.0.4).
	let aiCount = 0;
	const tags: string[] = [];
	for (const entry of merged) {
		if (entry.fromAiOnly && ++aiCount > settings.maxTags) continue;
		tags.push(entry.tag);
	}
	return { tags, dropped };
}
