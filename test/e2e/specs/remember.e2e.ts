import { browser, expect } from '@wdio/globals';
import { isMobileRun, MOCK_URL, openNote, openPopup, popup, popupButton, reset, snapshotData } from '../helpers';

type PluginData = {
	engines: { id: string; name: string; provider: string; model: string; baseUrl?: string }[];
	templates: { id: string; name: string }[];
	ui: { lastTemplateId?: string; templateChoices?: Record<string, { engineId?: string; location?: unknown }> };
};

/** The plugin's current data, read straight from its store. */
async function pluginData(): Promise<PluginData> {
	return browser.executeObsidian(({ app }) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { data: unknown } }> } }).plugins.plugins['inference-machine']!;
		return JSON.parse(JSON.stringify(plugin.store.data)) as PluginData;
	});
}

/** The id of a template, by name. */
async function templateId(name: string): Promise<string> {
	return (await pluginData()).templates.find((t) => t.name === name)!.id;
}

/** The popup's dropdowns, found by their options rather than their position. */
const templateSelect = () => popup().$('select');
const locationSelect = () => popup().$('select:has(option[value="folder"])');
const engineSelect = () => popup().$('select:has(option[value="mock"])');
const folderInput = () => popup().$('input[placeholder="Folder"]');

/** Closes the popup with Esc, closing any folder suggestions first. */
async function closePopup(): Promise<void> {
	for (let i = 0; i < 3 && (await popup().isExisting()); i++) {
		await browser.keys('Escape');
		await browser.pause(150);
	}
	await popup().waitForExist({ reverse: true });
}

/** Opens the popup and waits for trigger matching to settle. */
async function reopen(): Promise<void> {
	await openPopup();
	await browser.pause(400);
}

/** Remembering the popup's choices (Q52 to Q54, Q61, Q62). */
describe('Remembering popup choices', function () {
	let snapshot: string;

	before(async function () {
		if (isMobileRun()) this.skip();
		snapshot = await snapshotData();
	});

	beforeEach(async function () {
		await reset(snapshot);
		await openNote('Alpha.md');
	});

	it('restores the template and its location without a run (Q52)', async function () {
		await reopen();
		await templateSelect().selectByVisibleText('Action items');
		await locationSelect().selectByAttribute('value', 'folder');
		await folderInput().setValue('Out');
		await closePopup();

		await reopen();
		await expect(templateSelect()).toHaveValue(await templateId('Action items'));
		await expect(locationSelect()).toHaveValue('folder');
		await expect(folderInput()).toHaveValue('Out');
	});

	it('keeps each template\'s engine and location apart (Q53)', async function () {
		await browser.executeObsidian(async ({ app }, url) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { update(fn: (d: PluginData) => void): Promise<void> } }> } }).plugins.plugins['inference-machine']!;
			await plugin.store.update((d) => d.engines.push({ id: 'mock-2', name: 'Mock 2', provider: 'openai-compatible', model: 'mock-model', baseUrl: url }));
		}, MOCK_URL);
		await reopen();
		await templateSelect().selectByVisibleText('Action items');
		await engineSelect().selectByAttribute('value', 'mock-2');
		await locationSelect().selectByAttribute('value', 'folder');
		await folderInput().setValue('Out');

		await templateSelect().selectByVisibleText('Comprehensive summary');
		await expect(engineSelect()).toHaveValue('mock');
		await expect(locationSelect()).toHaveValue('alongside');

		await templateSelect().selectByVisibleText('Action items');
		await expect(engineSelect()).toHaveValue('mock-2');
		await expect(folderInput()).toHaveValue('Out');
	});

	it('goes back to the template\'s own settings with "Use template settings" (Q62)', async function () {
		await reopen();
		await expect(popupButton('Use template settings')).not.toExist();
		await locationSelect().selectByAttribute('value', 'folder');
		await folderInput().setValue('Out');
		await popupButton('Use template settings').click();
		await expect(locationSelect()).toHaveValue('alongside');
		await expect(popupButton('Use template settings')).not.toExist();
		expect((await pluginData()).ui.templateChoices).toBeUndefined();
	});

	it('resets a remembered location when the template\'s own location changes (Q61)', async function () {
		await reopen();
		await templateSelect().selectByVisibleText('Action items');
		await locationSelect().selectByAttribute('value', 'folder');
		await folderInput().setValue('Out');
		await closePopup();

		await browser.executeObsidian(async ({ app }) => {
			type Setting = { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } };
			const setting = (app as unknown as { setting: Setting }).setting;
			const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
			setting.open();
			setting.openTabById('inference-machine');
			await wait(600);
			const tab = setting.activeTab!.containerEl;
			const row = [...tab.querySelectorAll('.setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === 'Action items');
			[...row!.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!.click();
			await wait(600);
			const editor = tab.ownerDocument.querySelector('.im-template-editor')!;
			const locationRow = () => [...editor.querySelectorAll('.setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === 'Location')!;
			const mode = locationRow().querySelector('select')!;
			mode.value = 'folder';
			mode.dispatchEvent(new Event('change'));
			await wait(200);
			const folder = locationRow().querySelector<HTMLInputElement>('input[placeholder="Folder"]')!;
			folder.value = 'Tasks';
			folder.dispatchEvent(new Event('input'));
			[...editor.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();
			await wait(400);
			setting.close();
		});

		await reopen();
		await expect(templateSelect()).toHaveValue(await templateId('Action items'));
		await expect(locationSelect()).toHaveValue('folder');
		await expect(folderInput()).toHaveValue('Tasks');
		await expect(popupButton('Use template settings')).not.toExist();
	});

	it('lets a matching trigger pick the template, with that template\'s own location (Q54)', async function () {
		await reset(snapshot, 'cors', { template: { name: 'Flashcards', changes: { triggers: ['folder:Meetings'] } } });
		await openNote('Alpha.md');
		await reopen();
		await templateSelect().selectByVisibleText('Action items');
		await locationSelect().selectByAttribute('value', 'folder');
		await folderInput().setValue('Out');
		await closePopup();

		await openNote('Meetings/2026-10-01.md');
		await reopen();
		await expect(templateSelect()).toHaveValue(await templateId('Flashcards'));
		await expect(locationSelect()).toHaveValue('alongside');
		// Opening on a trigger's note doesn't change the remembered template.
		expect((await pluginData()).ui.lastTemplateId).toBe(await templateId('Action items'));
	});
});
