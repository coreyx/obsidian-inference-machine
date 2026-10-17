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
