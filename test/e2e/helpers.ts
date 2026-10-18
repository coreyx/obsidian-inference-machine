import { $, browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

/**
 * Shared steps for the end-to-end specs. Plugin state is reset through the
 * plugin's own settings store, so each test starts from a fresh install's
 * data plus the engine it asks for.
 */

export const MOCK_URL = 'http://127.0.0.1:4891/v1';
export const MOCK_NO_CORS_URL = 'http://127.0.0.1:4892/v1';

/** Which mock engine a test runs against. */
export type EngineMode = 'cors' | 'no-cors' | 'none';

/** Changes to apply to the plugin data after the reset. */
export interface DataPatch {
	globalSettings?: Record<string, unknown>;
	/** Changes to one template, found by name. */
	template?: { name: string; changes: Record<string, unknown> };
	/** Changes to several templates, found by name. */
	templates?: { name: string; changes: Record<string, unknown> }[];
	/** Template names in the order to put them first, as dragging in settings would. */
	order?: string[];
}

/** Whether this run is the mobile-emulation capability. */
export function isMobileRun(): boolean {
	const options = (browser.requestedCapabilities as Record<string, unknown>)['wdio:obsidianOptions'] as { emulateMobile?: boolean } | undefined;
	return options?.emulateMobile === true;
}

/** The plugin's data as a fresh install has it, captured once per spec. */
export async function snapshotData(): Promise<string> {
	return browser.executeObsidian(({ app }) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { data: unknown } }> } }).plugins.plugins['inference-machine']!;
		return JSON.stringify(plugin.store.data);
	});
}

/** Closes any open modal, resets the vault's files, and restores the plugin data with the chosen engine. */
export async function reset(snapshot: string, mode: EngineMode = 'cors', patch: DataPatch = {}): Promise<void> {
	for (let i = 0; i < 4 && (await $('.modal-container').isExisting()); i++) {
		await browser.keys('Escape');
		await browser.pause(150);
	}
	await obsidianPage.resetVault();
	const url = mode === 'no-cors' ? MOCK_NO_CORS_URL : MOCK_URL;
	await browser.executeObsidian(
		async ({ app }, snap, engineMode, engineUrl, change) => {
			type Data = { engines: unknown[]; defaultEngineId?: string; globalSettings: Record<string, unknown>; templates: { name: string }[] };
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { update(fn: (d: Data) => void): Promise<void> } }> } }).plugins.plugins['inference-machine']!;
			await plugin.store.update((data) => {
				Object.assign(data, JSON.parse(snap) as Data);
				if (engineMode !== 'none') {
					data.engines = [{ id: 'mock', name: 'Mock', provider: 'openai-compatible', model: 'mock-model', baseUrl: engineUrl }];
					data.defaultEngineId = 'mock';
				}
				Object.assign(data.globalSettings, change.globalSettings ?? {});
				for (const each of [...(change.template ? [change.template] : []), ...(change.templates ?? [])]) {
					Object.assign(data.templates.find((t) => t.name === each.name)!, each.changes);
				}
				if (change.order) {
					const first = change.order.map((name) => data.templates.find((t) => t.name === name)!);
					data.templates = [...first, ...data.templates.filter((t) => !first.includes(t))];
				}
			});
		},
		snapshot,
		mode,
		url,
		patch,
	);
}

/** The open Inference Machine popup. */
export const popup = () => $('.inference-machine-modal');

/** A button in the popup, by its label. */
export const popupButton = (label: string) => popup().$(`button=${label}`);

/** Opens a note in the active pane. */
export async function openNote(path: string): Promise<void> {
	await obsidianPage.openFile(path);
}

/** Opens the popup with the plugin's Open command. */
export async function openPopup(): Promise<void> {
	await browser.executeObsidianCommand('inference-machine:open');
	await popup().waitForExist();
}

/** Clicks Run and waits for the preview. A timeout reports what the popup showed instead, such as an error. */
export async function runToPreview(): Promise<void> {
	// On mobile the popup slides up from below the screen, so Run can't be clicked until it has settled.
	const run = popupButton('Run');
	await run.waitForClickable();
	await run.click();
	try {
		await popup().$('.im-path').waitForExist({ timeout: 30000 });
	} catch (error) {
		const shown = (await popup().isExisting()) ? await popup().getText() : '(the popup is closed)';
		throw new Error(`No preview after 30 seconds (${error instanceof Error ? error.message : String(error)}). The popup showed:\n${shown}`);
	}
}

/** A vault file's text, or null when it doesn't exist. */
export async function readFile(path: string): Promise<string | null> {
	return browser.executeObsidian(async ({ app }, p) => ((await app.vault.adapter.exists(p)) ? app.vault.adapter.read(p) : null), path);
}

/** Every Markdown file path in the vault. */
export async function notePaths(): Promise<string[]> {
	return browser.executeObsidian(({ app }) => app.vault.getMarkdownFiles().map((f) => f.path).sort());
}

/** The active file's path. */
export async function activePath(): Promise<string | null> {
	return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? null);
}

/** A note's text and modified time, to check the source note is never touched (2.4). */
export async function fingerprint(path: string): Promise<{ text: string; mtime: number }> {
	return browser.executeObsidian(async ({ app }, p) => {
		const file = app.vault.getFileByPath(p)!;
		return { text: await app.vault.read(file), mtime: file.stat.mtime };
	}, path);
}
