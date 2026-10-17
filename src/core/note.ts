/**
 * A read-only, plain-data copy of the source note, taken at the start of a
 * run (design.md). The core works only from this snapshot, so nothing in it
 * can reach the source file, and the source is never modified (2.0.4).
 */
export interface NoteSnapshot {
	/** Filename without extension. */
	title: string;
	/** Vault-relative path, including the extension. */
	path: string;
	/** Vault-relative path of the parent folder; empty at the vault root. */
	folder: string;
	/** Full contents, frontmatter included. */
	content: string;
	/** Contents without the frontmatter block. */
	body: string;
	/** The raw YAML text of the frontmatter, without the `---` fences. */
	frontmatterText: string;
	/** Parsed frontmatter values. */
	properties: Record<string, unknown>;
	/** Frontmatter `tags`, read the way Obsidian reads them (11.0.4). */
	frontmatterTags: string[];
	/** Inline `#tags` in the body, in order of appearance. */
	inlineTags: string[];
	/** Creation and modification times, in milliseconds since the epoch. */
	ctime: number;
	mtime: number;
}

/** The note's filename with its extension, such as `Alpha.md`. */
export function fileName(note: NoteSnapshot): string {
	return note.path.split('/').pop() ?? note.path;
}
