import YAML from 'yaml';

/**
 * A small stand-in for the `obsidian` module, which ships type declarations
 * only. Vitest aliases `obsidian` to this file (vitest.config.ts), so adapter
 * code can be unit-tested without a running Obsidian. It implements just the
 * surface the plugin uses, and grows with it.
 */

/** Minimal Plugin base class: records what the plugin registers. */
export class Plugin {
	app: unknown;
	manifest: unknown;

	constructor(app?: unknown, manifest?: unknown) {
		this.app = app;
		this.manifest = manifest;
	}

	/** Lifecycle hook, overridden by the plugin. */
	async onload(): Promise<void> {}

	/** Lifecycle hook, overridden by the plugin. */
	onunload(): void {}
}

/** Records notices instead of showing them, so tests can assert on them. */
export class Notice {
	static shown: string[] = [];

	constructor(message: string) {
		Notice.shown.push(message);
	}
}

/** Desktop by default; tests flip `isMobile` to exercise mobile gating. */
export const Platform = {
	isMobile: false,
	isDesktop: true,
	isDesktopApp: true,
	isMobileApp: false,
};

/** Obsidian parses frontmatter with a YAML 1.2 parser; the `yaml` package stands in for it. */
export function parseYaml(text: string): unknown {
	return YAML.parse(text) as unknown;
}

/** Obsidian's `stringifyYaml` writes block-style YAML ending in a newline. */
export function stringifyYaml(value: unknown): string {
	return YAML.stringify(value);
}

/** The parameters `requestUrl` was called with, as Obsidian defines them. */
export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}

/** Tests set `handler` to script `requestUrl`; calling it without one is a test bug. */
export const requestUrlFixture: { handler?: (param: RequestUrlParam) => { status: number; text: string } | Promise<{ status: number; text: string }> } = {};

/** Obsidian's CORS-free request function, scripted through `requestUrlFixture`. */
export async function requestUrl(param: RequestUrlParam): Promise<{ status: number; text: string }> {
	if (!requestUrlFixture.handler) throw new Error('requestUrl called without a test fixture');
	return requestUrlFixture.handler(param);
}

/** Obsidian's path normalization: forward slashes, no duplicate, leading or trailing slashes. */
export function normalizePath(path: string): string {
	const cleaned = path
		.replace(/[\\]/gu, '/')
		.replace(/\/+/gu, '/')
		.replace(/^\/|\/$/gu, '')
		.normalize('NFC');
	return cleaned === '' ? '/' : cleaned;
}

/** Base class for vault entries. */
export class TAbstractFile {
	parent: TFolder | null = null;
	constructor(
		public path: string,
		public name: string,
	) {}
}

/** A folder in the fake vault. */
export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === '/';
	}
}

/** A file in the fake vault. */
export class TFile extends TAbstractFile {
	stat = { ctime: 0, mtime: 0, size: 0 };
	get basename(): string {
		return this.name.replace(/\.[^.]+$/u, '');
	}
	get extension(): string {
		return /\.([^.]+)$/u.exec(this.name)?.[1] ?? '';
	}
}

/** Splits a leading frontmatter block the way Obsidian's helper does. */
export function getFrontMatterInfo(content: string): { exists: boolean; frontmatter: string; from: number; to: number; contentStart: number } {
	const match = /^---\r?\n([\s\S]*?\r?\n)?---(?:\r?\n|$)/u.exec(content);
	if (!match) return { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
	const from = 4;
	return { exists: true, frontmatter: match[1] ?? '', from, to: from + (match[1]?.length ?? 0), contentStart: match[0].length };
}

/** Reads frontmatter tags as Obsidian does: a list, or one string split on commas and spaces. Tags come back with `#`. */
export function parseFrontMatterTags(frontmatter: Record<string, unknown> | null): string[] | null {
	const raw = frontmatter?.tags ?? frontmatter?.tag;
	if (raw === undefined || raw === null) return null;
	// Matches Obsidian 1.14.4: a string with whitespace gives no tags ("alpha, beta" → []),
	// and any other string is one tag, comma and all ("alpha,beta" → ["#alpha,beta"]).
	const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? (/\s/u.test(raw.trim()) ? [] : [raw]) : [];
	const tags = items.map((t) => t.trim()).filter((t) => t !== '').map((t) => (t.startsWith('#') ? t : `#${t}`));
	return tags;
}

/** Every tag in a cache entry, frontmatter first, with `#`. */
export function getAllTags(cache: { frontmatter?: Record<string, unknown>; tags?: { tag: string }[] }): string[] | null {
	const tags = [...(parseFrontMatterTags(cache.frontmatter ?? null) ?? []), ...(cache.tags ?? []).map((t) => t.tag)];
	return tags.length > 0 ? tags : null;
}
