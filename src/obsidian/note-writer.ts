import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import { numbered, sanitizeFilename } from '../core/filename';
import type { NoteSnapshot } from '../core/note';
import type { OutputLocation } from '../core/schema';

/**
 * Creating the output note (REQ-10). This module creates new files only: it
 * has no way to modify an existing one, so it can't overwrite a note and
 * can't touch the source note (2.0.4, 10.0.4).
 */

/** The folder the output goes in: the chosen folder, or the source note's own folder (10.0.1). */
export function outputFolder(location: OutputLocation, source: NoteSnapshot): string {
	const folder = location.mode === 'alongside' ? source.folder : location.path;
	const normalized = normalizePath(folder.trim());
	return normalized === '/' ? '' : normalized;
}

/** Whether anything, file or folder, already exists at a path. */
async function taken(app: App, path: string): Promise<boolean> {
	// The adapter checks the file system itself, which also catches names that differ
	// only in case on case-insensitive file systems.
	return app.vault.getAbstractFileByPath(path) !== null || (await app.vault.adapter.exists(path));
}

/** The path for a note named `name` in `folder`, before any collision numbering. */
export function notePath(folder: string, name: string): string {
	return normalizePath(folder === '' ? `${name}.md` : `${folder}/${name}.md`);
}

/**
 * Plans the output path: sanitizes the name (10.0.3), then adds ` 1`, ` 2`
 * and so on until the name is free, the way Obsidian numbers new notes
 * (10.0.4). It never returns a path that's in use.
 */
export async function planPath(app: App, folder: string, name: string): Promise<string> {
	const base = sanitizeFilename(name);
	for (let n = 0; ; n++) {
		const path = notePath(folder, numbered(base, n));
		if (!(await taken(app, path))) return path;
	}
}

/** Creates every missing level of a folder path (10.0.2). */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	if (folder === '') return;
	const segments = folder.split('/');
	for (let i = 1; i <= segments.length; i++) {
		const path = segments.slice(0, i).join('/');
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) continue;
		if (existing) throw new Error(`Can't create the folder "${folder}": "${path}" is a file.`);
		await app.vault.createFolder(path);
	}
}

/** Creates the note. Fails rather than overwrite if the path was taken in the meantime. */
export async function createNote(app: App, path: string, text: string): Promise<TFile> {
	const slash = path.lastIndexOf('/');
	await ensureFolder(app, slash === -1 ? '' : path.slice(0, slash));
	return app.vault.create(path, text);
}

/** Opens the new note in a new tab, so the source note stays open where it was (10.0.7). */
export async function openNote(app: App, file: TFile): Promise<void> {
	await app.workspace.getLeaf('tab').openFile(file);
}

/** The vault's file for a path, if it's a note. */
export function fileAt(app: App, path: string): TFile | undefined {
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : undefined;
}
