import { browser, expect } from '@wdio/globals';
import {
	closeRememberPopup as closePopup,
	engineSelect,
	folderInput,
	isMobileRun,
	locationSelect,
	MOCK_URL,
	openNote,
	pluginData,
	popup,
	popupButton,
	reopenPopup as reopen,
	reset,
	snapshotData,
	templateId,
	templateSelect,
	type PluginData,
} from '../helpers';

/*
 * The remembering walkthrough's manual steps, which restart Obsidian. They live
 * in their own spec file, so they get an Obsidian of their own, and they never
 * call `resetVault`: the test vault has no config folder, so `resetVault`
 * deletes the running vault's, the plugin's data.json included. The plugin
 * carries on from memory, so other specs don't notice, but a restart would
 * load it with no data.
 */

/** Adds a second engine, as a user with a remote engine and LM Studio would have. */
async function addSecondEngine(): Promise<void> {
	await browser.executeObsidian(async ({ app }, url) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { update(fn: (d: PluginData) => void): Promise<void> } }> } }).plugins.plugins['inference-machine']!;
		await plugin.store.update((d) => d.engines.push({ id: 'lms', name: 'LM Studio', provider: 'openai-compatible', model: 'mock-model', baseUrl: url }));
	}, MOCK_URL);
}

/** Deletes an engine the way a user does: its Delete control in the plugin's settings, then the confirmation. */
async function deleteEngineInSettings(name: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, engineName) => {
		type Setting = { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } };
		const setting = (app as unknown as { setting: Setting }).setting;
		const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
		setting.open();
		setting.openTabById('inference-machine');
		await wait(600);
		const tab = setting.activeTab!.containerEl;
		const row = [...tab.querySelectorAll<HTMLElement>('.setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === engineName);
		if (!row) throw new Error(`No settings row named "${engineName}"`);
		// The list's own delete control is drawn by Obsidian, so it's found by its label rather than its markup.
		const remove = [...row.querySelectorAll<HTMLElement>('[aria-label]')].find((e) => /delete|remove/i.test(e.getAttribute('aria-label') ?? ''));
		if (!remove) throw new Error(`No delete control on the "${engineName}" row: ${row.outerHTML}`);
		remove.click();
		await wait(400);
		const confirm = [...tab.ownerDocument.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === 'Delete');
		if (!confirm) throw new Error('No Delete button in the confirmation');
		confirm.click();
		await wait(400);
		setting.close();
	}, name);
}

/** Restarts Obsidian on the same vault, keeping its files and the plugin's data.json. */
async function restartObsidian(): Promise<void> {
	await browser.reloadObsidian();
	await openNote('Alpha.md');
}

/**
 * The walkthrough's manual verification steps, run in real Obsidian:
 * two engines, the per-template command, a restart, deleting an engine in
 * settings, and updating from 0.3.0 with a remembered location. These
 * restart Obsidian, so they run last.
 */
describe('Remembering popup choices: the manual walkthrough', function () {
	let snapshot: string;

	before(async function () {
		if (isMobileRun()) this.skip();
		snapshot = await snapshotData();
	});

	beforeEach(async function () {
		// Only the plugin data is restored, never the vault's files: see the file comment.
		await reset(snapshot, 'cors', {}, false);
		await openNote('Alpha.md');
	});

	it('restores, separates, resets, survives a command and a restart, and forgets a deleted engine', async function () {
		await addSecondEngine();
		const summary = await templateId('Comprehensive summary');
		const keyPoints = await templateId('Key points / TL;DR');

		// Steps 1 and 2: choices made and closed without running come back.
		await reopen();
		await templateSelect().selectByVisibleText('Comprehensive summary');
		await engineSelect().selectByAttribute('value', 'lms');
		await locationSelect().selectByAttribute('value', 'folder');
		await folderInput().setValue('Summaries');
		await closePopup();
		await reopen();
		await expect(templateSelect()).toHaveValue(summary);
		await expect(engineSelect()).toHaveValue('lms');
		await expect(locationSelect()).toHaveValue('folder');
		await expect(folderInput()).toHaveValue('Summaries');
		await expect(popupButton('Use template settings')).toExist();

		// Step 3: another template keeps its own engine and location.
		await templateSelect().selectByVisibleText('Key points / TL;DR');
		await expect(engineSelect()).toHaveValue('mock');
		await expect(locationSelect()).toHaveValue('alongside');
		await expect(popupButton('Use template settings')).not.toExist();

		// Step 4: "Use template settings" goes back to the template's own settings.
		await templateSelect().selectByVisibleText('Comprehensive summary');
		await popupButton('Use template settings').click();
		await expect(engineSelect()).toHaveValue('mock');
		await expect(locationSelect()).toHaveValue('alongside');
		await expect(popupButton('Use template settings')).not.toExist();

		// Step 5: the per-template command opens on its template, with its remembered engine,
		// even though another template was the last one chosen.
		await engineSelect().selectByAttribute('value', 'lms');
		await templateSelect().selectByVisibleText('Key points / TL;DR');
		await closePopup();
		await browser.executeObsidianCommand(`inference-machine:derive-${summary}`);
		await popup().waitForExist();
		await browser.pause(400);
		await expect(templateSelect()).toHaveValue(summary);
		await expect(engineSelect()).toHaveValue('lms');
		await closePopup();

		// Step 6: a restart keeps every choice.
		await restartObsidian();
		await reopen();
		await expect(templateSelect()).toHaveValue(keyPoints);
		await templateSelect().selectByVisibleText('Comprehensive summary');
		await expect(engineSelect()).toHaveValue('lms');
		await expect(popupButton('Use template settings')).toExist();
		await closePopup();

		// Step 7: deleting the engine in settings forgets it, with no error.
		await deleteEngineInSettings('LM Studio');
		expect((await pluginData()).engines.map((e) => e.id)).toEqual(['mock']);
		await reopen();
		await expect(templateSelect()).toHaveValue(summary);
		await expect(engineSelect()).toHaveValue('mock');
		await expect(popupButton('Use template settings')).not.toExist();
		await expect(popup().$('.im-error')).not.toExist();
		expect((await pluginData()).ui.templateChoices).toBeUndefined();
	});

	it('forgets the single location 0.3.0 remembered for every template (step 8)', async function () {
		const dataPath = await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { manifest: { dir: string }; store: { data: Record<string, unknown> } }> } }).plugins.plugins['inference-machine']!;
			const old = JSON.parse(JSON.stringify(plugin.store.data)) as { ui: Record<string, unknown> };
			old.ui = { lastLocation: { mode: 'folder', path: 'Old' } };
			const file = `${plugin.manifest.dir}/data.json`;
			await app.vault.adapter.write(file, JSON.stringify(old));
			return file;
		});
		await restartObsidian();

		await reopen();
		await expect(locationSelect()).toHaveValue('alongside');
		expect((await pluginData()).ui).toEqual({});
		const saved = await browser.executeObsidian(async ({ app }, file) => app.vault.adapter.read(file), dataPath);
		expect(saved).not.toContain('lastLocation');
	});
});
