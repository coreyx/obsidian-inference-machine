import { getAllTags, TFile, type App, type CachedMetadata, type EventRef } from 'obsidian';

/**
 * The vault's tags, for AI tagging (14.0.3, 14.0.7). It's built lazily, the
 * first time AI tagging needs it, so with AI tagging off the vault's tags are
 * never even collected (14.1). Once built, it's kept current from metadata
 * cache events rather than rebuilt on every run.
 */
export class VaultTagIndex {
	/** Tags per file path, so a changed file's old tags can be subtracted. */
	private byFile: Map<string, string[]> | undefined;
	private counts = new Map<string, number>();

	constructor(private readonly app: App) {}

	/** Whether the index has been built. */
	get built(): boolean {
		return this.byFile !== undefined;
	}

	/**
	 * Subscribes to the events that keep the index current. Pass the plugin's
	 * `registerEvent` so the subscriptions end when the plugin unloads.
	 */
	attach(register: (ref: EventRef) => void): void {
		register(this.app.metadataCache.on('changed', (file, _data, cache) => this.update(file.path, cache)));
		register(this.app.metadataCache.on('deleted', (file) => this.update(file.path, null)));
		register(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!this.byFile || !(file instanceof TFile)) return;
				const tags = this.byFile.get(oldPath);
				if (tags === undefined) return;
				this.byFile.delete(oldPath);
				this.byFile.set(file.path, tags);
			}),
		);
	}

	private ensureBuilt(): Map<string, string[]> {
		if (this.byFile) return this.byFile;
		this.byFile = new Map();
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.add(file.path, this.tagsOf(this.app.metadataCache.getFileCache(file)));
		}
		return this.byFile;
	}

	private tagsOf(cache: CachedMetadata | null): string[] {
		return (cache ? (getAllTags(cache) ?? []) : []).map((tag) => tag.replace(/^#/u, ''));
	}

	private add(path: string, tags: string[]): void {
		this.byFile!.set(path, tags);
		for (const tag of tags) this.counts.set(tag, (this.counts.get(tag) ?? 0) + 1);
	}

	private update(path: string, cache: CachedMetadata | null): void {
		// Before the first build there's nothing to keep current.
		if (!this.byFile) return;
		for (const tag of this.byFile.get(path) ?? []) {
			const count = (this.counts.get(tag) ?? 1) - 1;
			if (count <= 0) this.counts.delete(tag);
			else this.counts.set(tag, count);
		}
		this.byFile.delete(path);
		if (cache) this.add(path, this.tagsOf(cache));
	}

	/** The vault's tags, most used first, capped at `limit` (14.0.3 caps at 1,000). */
	ranked(limit: number): string[] {
		this.ensureBuilt();
		return [...this.counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, limit)
			.map(([tag]) => tag);
	}

	/** Every group prefix in the vault: `ai/` for `ai/llm`, and both `dev/` and `dev/frontend/` for `dev/frontend/react` (14.0.7). */
	prefixes(): string[] {
		this.ensureBuilt();
		const prefixes = new Set<string>();
		for (const tag of this.counts.keys()) {
			const segments = tag.split('/');
			for (let i = 1; i < segments.length; i++) prefixes.add(`${segments.slice(0, i).join('/')}/`);
		}
		return [...prefixes].sort();
	}
}
