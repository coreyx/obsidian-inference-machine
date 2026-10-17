import type { NoteSnapshot } from '../../src/core/note';

/** Builds a `NoteSnapshot` the way the note reader would, from a path and full text. */
export function snapshot(path: string, content: string, properties: Record<string, unknown> = {}, extra: Partial<NoteSnapshot> = {}): NoteSnapshot {
	const match = /^---\n([\s\S]*?)\n---\n?/u.exec(content);
	const parts = path.split('/');
	const file = parts.pop() ?? path;
	return {
		title: file.replace(/\.md$/u, ''),
		path,
		folder: parts.join('/'),
		content,
		body: match ? content.slice(match[0].length) : content,
		frontmatterText: match?.[1] ?? '',
		properties,
		frontmatterTags: [],
		inlineTags: [],
		ctime: new Date(2026, 9, 1, 9, 30, 0).getTime(),
		mtime: new Date(2026, 9, 2, 14, 5, 7).getTime(),
		...extra,
	};
}

/** `Projects/Alpha.md`, with frontmatter, used across tests. */
export const alpha = snapshot(
	'Projects/Alpha.md',
	'---\nauthor: Ada\nstatus: active\n---\n# Alpha\n\nWe ship the beta next week. #launch\n',
	{ author: 'Ada', status: 'active', 'key with spaces': 'spaced' },
);
