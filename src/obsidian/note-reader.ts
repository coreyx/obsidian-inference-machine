import { getFrontMatterInfo, parseFrontMatterTags, type App, type TFile } from 'obsidian';
import type { NoteSnapshot } from '../core/note';

/** Removes the leading `#` Obsidian's tag helpers include. */
function bare(tag: string): string {
	return tag.replace(/^#/u, '');
}

/**
 * Reads the source note into a plain snapshot (design.md). Only read APIs
 * are used, and nothing here holds on to the file, so no code path that
 * starts from a snapshot can modify the source note (2.0.4).
 *
 * Tags come from Obsidian's own parsing, so the plugin and the vault agree
 * on what the note's tags are: `parseFrontMatterTags` reads `tags` whether
 * it's a list or a single string (11.0.4), and the metadata cache lists
 * inline tags with their positions.
 */
export async function readNote(app: App, file: TFile): Promise<NoteSnapshot> {
	const content = await app.vault.cachedRead(file);
	const cache = app.metadataCache.getFileCache(file);
	const info = getFrontMatterInfo(content);

	const properties: Record<string, unknown> = { ...(cache?.frontmatter ?? {}) };
	// Older metadata caches include the block's position among the values.
	delete properties.position;

	const inlineTags = [...(cache?.tags ?? [])]
		.sort((a, b) => a.position.start.offset - b.position.start.offset)
		.map((t) => bare(t.tag));

	const folder = file.parent?.path ?? '';
	return {
		title: file.basename,
		path: file.path,
		folder: folder === '/' ? '' : folder,
		content,
		body: info.exists ? content.slice(info.contentStart) : content,
		frontmatterText: info.exists ? info.frontmatter.replace(/\n$/u, '') : '',
		properties,
		frontmatterTags: (parseFrontMatterTags(cache?.frontmatter ?? null) ?? []).map(bare),
		inlineTags,
		ctime: file.stat.ctime,
		mtime: file.stat.mtime,
	};
}
