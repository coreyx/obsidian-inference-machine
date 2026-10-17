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
