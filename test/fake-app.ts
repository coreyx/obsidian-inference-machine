import type { App, TFile as ObsidianTFile } from 'obsidian';
import YAML from 'yaml';
import { getFrontMatterInfo, TFile, TFolder } from './obsidian-stub';

/** A metadata-cache entry as the fake builds it. */
export interface FakeCache {
	frontmatter?: Record<string, unknown>;
	tags?: { tag: string; position: { start: { offset: number } } }[];
}

type Listener = (...args: unknown[]) => void;

/** One recorded change to the vault, so tests can assert what was (and wasn't) written. */
export interface VaultWrite {
	op: 'create' | 'createFolder' | 'modify';
	path: string;
}

/** Parses frontmatter and inline `#tags` from note text, approximating Obsidian's metadata cache. */
function buildCache(content: string): FakeCache {
	const info = getFrontMatterInfo(content);
	const cache: FakeCache = {};
	if (info.exists) {
		const parsed: unknown = YAML.parse(info.frontmatter);
		if (parsed && typeof parsed === 'object') cache.frontmatter = parsed as Record<string, unknown>;
	}
	const body = content.slice(info.contentStart);
	const tags = [...body.matchAll(/(?<![\w#&])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)].map((m) => ({
		tag: `#${m[1]}`,
		position: { start: { offset: info.contentStart + m.index } },
	}));
	if (tags.length > 0) cache.tags = tags;
	return cache;
}

/**
 * An in-memory Obsidian app: a vault of notes and folders, a metadata cache
 * built from the notes' text, link generation, a workspace that records what
 * it opened, and SecretStorage. It implements only what the plugin uses.
 */
export class FakeApp {
	readonly files = new Map<string, { file: TFile; content: string }>();
	readonly folders = new Map<string, TFolder>();
	readonly writes: VaultWrite[] = [];
	readonly opened: string[] = [];
	readonly secrets = new Map<string, string>();
	activeFile: TFile | null = null;
	/** Paths the adapter reports as existing on disk though the vault index doesn't list them (case-insensitive FS). */
	readonly diskOnly = new Set<string>();
	private readonly listeners = new Map<string, Listener[]>();
	private clock = Date.UTC(2026, 9, 1);

	constructor(notes: Record<string, string> = {}) {
		this.folders.set('/', new TFolder('/', ''));
		for (const [path, content] of Object.entries(notes)) this.addNote(path, content);
	}

	/** Adds a note without recording it as a write, as if it were already in the vault. */
	addNote(path: string, content: string): TFile {
		const slash = path.lastIndexOf('/');
		const parent = slash === -1 ? this.folders.get('/')! : this.ensureFolderEntry(path.slice(0, slash));
		const file = new TFile(path, path.slice(slash + 1));
		file.parent = parent;
		file.stat = { ctime: this.clock, mtime: this.clock, size: content.length };
		this.clock += 1000;
		parent.children.push(file);
		this.files.set(path, { file, content });
		return file;
	}

	private ensureFolderEntry(path: string): TFolder {
		const existing = this.folders.get(path);
		if (existing) return existing;
		const slash = path.lastIndexOf('/');
		const parent = slash === -1 ? this.folders.get('/')! : this.ensureFolderEntry(path.slice(0, slash));
		const folder = new TFolder(path, path.slice(slash + 1));
		folder.parent = parent;
		parent.children.push(folder);
		this.folders.set(path, folder);
		return folder;
	}

	private on(name: string, callback: Listener) {
		const list = this.listeners.get(name) ?? [];
		list.push(callback);
		this.listeners.set(name, list);
		return { name, callback };
	}

	/** Fires a metadata-cache or vault event to whoever subscribed. */
	trigger(name: string, ...args: unknown[]): void {
		for (const callback of this.listeners.get(name) ?? []) callback(...args);
	}

	/** Changes a note's text the way an edit in Obsidian would, firing `changed`. */
	edit(path: string, content: string): void {
		const entry = this.files.get(path)!;
		entry.content = content;
		this.trigger('metadata:changed', entry.file, content, buildCache(content));
	}

	/** A note in the vault, typed as Obsidian's `TFile` for code under test. */
	file(path: string): ObsidianTFile {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`No note at ${path}`);
		return entry.file as unknown as ObsidianTFile;
	}

	/** The fake, typed as Obsidian's `App` for code under test. */
	get app(): App {
		return this.asApp as unknown as App;
	}

	private readonly asApp = {
		vault: {
			getAbstractFileByPath: (path: string) => this.files.get(path)?.file ?? this.folders.get(path) ?? null,
			getMarkdownFiles: () => [...this.files.values()].map((e) => e.file).filter((f) => f.extension === 'md'),
			cachedRead: async (file: TFile) => this.files.get(file.path)!.content,
			read: async (file: TFile) => this.files.get(file.path)!.content,
			create: async (path: string, content: string) => {
				if (this.files.has(path)) throw new Error('File already exists.');
				this.writes.push({ op: 'create', path });
				const file = this.addNote(path, content);
				this.trigger('vault:create', file);
				return file;
			},
			createFolder: async (path: string) => {
				if (this.folders.has(path)) throw new Error('Folder already exists.');
				this.writes.push({ op: 'createFolder', path });
				return this.ensureFolderEntry(path);
			},
			modify: async (file: TFile, content: string) => {
				this.writes.push({ op: 'modify', path: file.path });
				this.files.get(file.path)!.content = content;
			},
			adapter: {
				exists: async (path: string) =>
					this.diskOnly.has(path.toLowerCase()) || [...this.files.keys(), ...this.folders.keys()].some((p) => p.toLowerCase() === path.toLowerCase()),
			},
			on: (name: string, callback: Listener) => this.on(`vault:${name}`, callback),
			getRoot: () => this.folders.get('/')!,
			getAllFolders: () => [...this.folders.values()].filter((f) => f.path !== '/'),
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const entry = this.files.get(file.path);
				return entry ? buildCache(entry.content) : null;
			},
			on: (name: string, callback: Listener) => this.on(`metadata:${name}`, callback),
		},
		fileManager: {
			generateMarkdownLink: (file: TFile) => `[[${file.basename}]]`,
		},
		workspace: {
			getActiveFile: () => this.activeFile,
			getLeaf: () => ({
				openFile: async (file: TFile) => {
					this.opened.push(file.path);
				},
			}),
		},
		secretStorage: {
			getSecret: (id: string) => this.secrets.get(id) ?? null,
			setSecret: (id: string, value: string) => {
				this.secrets.set(id, value);
			},
			listSecrets: () => [...this.secrets.keys()],
		},
	};
}
