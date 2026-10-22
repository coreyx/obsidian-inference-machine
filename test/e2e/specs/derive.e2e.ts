import { $, browser, expect } from '@wdio/globals';
import {
	activePath,
	fingerprint,
	isMobileRun,
	notePaths,
	openNote,
	openPopup,
	popup,
	popupButton,
	readFile,
	reset,
	runToPreview,
	snapshotData,
} from '../helpers';

/** The output-location dropdown, found by its options rather than its position. */
const locationSelect = () => popup().$('select:has(option[value="folder"])');

/** The popup flows on desktop (REQ-1, REQ-2, REQ-8 to REQ-10, REQ-19). */
describe('Inference Machine on desktop', function () {
	let snapshot: string;
	let alpha: { text: string; mtime: number };
	const summaryPath = 'Alpha - Comprehensive summary.md';

	before(async function () {
		if (isMobileRun()) this.skip();
		snapshot = await snapshotData();
		alpha = await fingerprint('Alpha.md');
	});

	beforeEach(async function () {
		await reset(snapshot);
		await openNote('Alpha.md');
	});

	afterEach(async function () {
		// 2.4: whatever the test did, the source note is unchanged.
		expect(await fingerprint('Alpha.md')).toEqual(alpha);
	});

	it('opens from the ribbon (1.1) and the Open command (1.2)', async function () {
		await $('.side-dock-ribbon-action[aria-label="Open Inference Machine"]').click();
		await expect(popup()).toExist();
		await browser.keys('Escape');
		await expect(popup()).not.toExist();
		await openPopup();
		await expect(popup()).toExist();
	});

	it('preselects the template of a "Derive with" command (1.3)', async function () {
		const id = await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { data: { templates: { id: string; name: string }[] } } }> } }).plugins.plugins['inference-machine']!;
			return plugin.store.data.templates.find((t) => t.name === 'Action items')!.id;
		});
		await browser.executeObsidianCommand(`inference-machine:derive-${id}`);
		await expect(popup().$('select')).toHaveValue(id);
	});

	it('renames and removes template commands with their templates (1.4)', async function () {
		const names = await browser.executeObsidian(async ({ app }) => {
			type Plugin = { store: { update(fn: (d: { templates: { name: string }[] }) => void): Promise<void> } };
			const plugin = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins['inference-machine']!;
			await plugin.store.update((d) => {
				d.templates.find((t) => t.name === 'Action items')!.name = 'Tasks';
				d.templates = d.templates.filter((t) => t.name !== 'Flashcards');
			});
			const commands = (app as unknown as { commands: { commands: Record<string, { name: string }> } }).commands.commands;
			return Object.values(commands)
				.map((c) => c.name)
				.filter((n) => n.startsWith('Inference Machine: Derive with'));
		});
		expect(names).toContain('Inference Machine: Derive with Tasks');
		expect(names).not.toContain('Inference Machine: Derive with Action items');
		expect(names).not.toContain('Inference Machine: Derive with Flashcards');
	});

	it('prefills the note being viewed (2.1)', async function () {
		await openNote('Meetings/2026-10-01.md');
		await openPopup();
		await expect(popup()).toHaveText(expect.stringContaining('Meetings/2026-10-01.md'));
	});

	it('leaves the source empty when a canvas is active, and Run disabled (2.3)', async function () {
		await openNote('Board.canvas');
		await openPopup();
		await expect(popup()).toHaveText(expect.stringContaining('No note selected'));
		await expect(popupButton('Run')).toBeDisabled();
	});

	it('explains that an engine is needed when there is none (3.6)', async function () {
		await reset(snapshot, 'none');
		await openPopup();
		await expect(popup()).toHaveText(expect.stringContaining('needs an AI engine'));
		await expect(popupButton('Open engine settings')).toExist();
		await expect(popupButton('Run')).not.toExist();
	});

	it('runs, previews exactly what will be saved, keeps edits, and saves (8.1, 9.1, 9.2, 10.5)', async function () {
		await openPopup();
		await runToPreview();
		const editor = popup().$('.cm-content');
		await expect(editor).toHaveText(expect.stringContaining('# References'));
		await editor.click();
		await browser.keys(['Control', 'End']);
		await browser.keys('Added in the preview.');
		await popupButton('Save').click();
		await popup().waitForExist({ reverse: true });
		const saved = (await readFile(summaryPath))!;
		expect(saved).toContain('## Summary\n\nThe team plans to ship the beta next week.\n\n## Key points\n\n- The beta ships next week.');
		expect(saved).toContain('tags:\n  - reading\n  - ai/llm\n  - inline-tag');
		expect(saved).toContain('# References\n\n- [[Alpha]]');
		expect(saved).toContain('Added in the preview.');
		// 10.0.7: the new note opens.
		expect(await activePath()).toBe(summaryPath);
	});

	it('writes nothing when the preview is discarded (9.3)', async function () {
		const before = await notePaths();
		await openPopup();
		await runToPreview();
		await popupButton('Discard').click();
		await popup().waitForExist({ reverse: true });
		expect(await notePaths()).toEqual(before);
	});

	it('saves without a preview when the template skips it (9.4)', async function () {
		await reset(snapshot, 'cors', { template: { name: 'Comprehensive summary', changes: { skipPreview: true } } });
		await openNote('Alpha.md');
		await openPopup();
		await popupButton('Run').click();
		await browser.waitUntil(async () => (await readFile(summaryPath)) !== null, { timeout: 30000 });
		await expect(popup()).not.toExist();
	});

	it('creates the note in a chosen folder, creating it (10.1), or next to the source (10.2)', async function () {
		await openPopup();
		await locationSelect().selectByAttribute('value', 'folder');
		const folder = popup().$('input[placeholder="Folder"]');
		await folder.setValue('Summaries/Weekly');
		// Close the folder suggestions without closing the popup.
		await popup().$('.modal-title').click();
		await runToPreview();
		await expect(popup().$('.im-path')).toHaveText('Saves to Summaries/Weekly/Alpha - Comprehensive summary.md');
		await popupButton('Save').click();
		await browser.waitUntil(async () => (await readFile('Summaries/Weekly/Alpha - Comprehensive summary.md')) !== null);

		await openNote('Meetings/2026-10-01.md');
		await openPopup();
		await locationSelect().selectByAttribute('value', 'alongside');
		await runToPreview();
		await expect(popup().$('.im-path')).toHaveText('Saves to Meetings/2026-10-01 - Comprehensive summary.md');
	});

	it('numbers a second run\'s note instead of overwriting (10.4)', async function () {
		for (let i = 0; i < 2; i++) {
			await openNote('Alpha.md');
			await openPopup();
			await runToPreview();
			await popupButton('Save').click();
			await popup().waitForExist({ reverse: true });
		}
		expect(await notePaths()).toEqual(expect.arrayContaining([summaryPath, 'Alpha - Comprehensive summary 1.md']));
	});

	it('leaves the active note alone when "Open the new note" is off (10.8)', async function () {
		await reset(snapshot, 'cors', { globalSettings: { openAfterCreate: false } });
		await openNote('Alpha.md');
		await openPopup();
		await runToPreview();
		await popupButton('Save').click();
		await browser.waitUntil(async () => (await readFile(summaryPath)) !== null);
		expect(await activePath()).toBe('Alpha.md');
	});

	it('can be run from the keyboard alone (19.2)', async function () {
		await openPopup();
		// Focus starts on Run. Back up to the template dropdown and pick the next template.
		for (let i = 0; i < 4; i++) await browser.keys(['Shift', 'Tab']);
		await browser.keys('ArrowDown');
		await expect(popup().$('select')).toHaveText(expect.stringContaining('Key points'));
		await browser.pause(200);
		await browser.keys(['Control', 'Enter']);
		await popup().$('.im-path').waitForExist({ timeout: 30000 });
		await browser.keys(['Control', 'Enter']);
		await browser.waitUntil(async () => (await readFile('Alpha - Key points.md')) !== null, { timeout: 30000 });
	});

	it('remembers the template used last (19.3)', async function () {
		await openPopup();
		await popup().$('select').selectByVisibleText('Action items');
		await runToPreview();
		await popupButton('Discard').click();
		await popup().waitForExist({ reverse: true });
		await openPopup();
		const selected = await popup().$('select').getValue();
		const actionItems = await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { data: { templates: { id: string; name: string }[] } } }> } }).plugins.plugins['inference-machine']!;
			return plugin.store.data.templates.find((t) => t.name === 'Action items')!.id;
		});
		expect(selected).toBe(actionItems);
	});

	it('splits frontmatter tags written as one string (11.4)', async function () {
		await openNote('Beta.md');
		await openPopup();
		await runToPreview();
		// The editor's rendered text drops list indentation, so match the lines loosely.
		await expect(popup().$('.cm-content')).toHaveText(expect.stringMatching(/tags:\n\s*- alpha\n\s*- beta/u));
	});

	it('lets a template override carrying images and frontmatter', async function () {
		const result = await browser.executeObsidian(async ({ app }) => {
			type Setting = { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement }; win?: Window };
			type Plugin = { store: { data: { templates: { name: string; carryImages?: boolean; carryProperties?: boolean }[] } } };
			const setting = (app as unknown as { setting: Setting }).setting;
			const plugin = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins['inference-machine']!;
			const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
			setting.open();
			setting.openTabById('inference-machine');
			await wait(600);
			const tab = setting.activeTab!.containerEl;
			const row = [...tab.querySelectorAll('.setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === 'Key points / TL;DR');
			[...row!.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!.click();
			await wait(600);
			const editor = tab.ownerDocument.querySelector('.im-template-editor')!;
			const dropdown = (name: string) =>
				[...editor.querySelectorAll('.setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === name)?.querySelector('select');
			const images = dropdown('Carry leading images')!;
			const properties = dropdown('Copy the source\'s frontmatter')!;
			const shown = { images: images.value, imagesLabel: images.options[0]?.textContent, properties: properties.value };
			images.value = 'off';
			images.dispatchEvent(new Event('change'));
			[...editor.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();
			await wait(400);
			const saved = plugin.store.data.templates.find((t) => t.name === 'Key points / TL;DR')!;
			const after = { carryImages: saved.carryImages, setsCarryProperties: 'carryProperties' in saved };
			// Put the built-in back as it was, for the scenarios that follow.
			delete saved.carryImages;
			setting.close();
			return { shown, after };
		});
		expect(result.shown).toEqual({ images: 'inherit', imagesLabel: 'Inherit (on)', properties: 'inherit' });
		expect(result.after).toEqual({ carryImages: false, setsCarryProperties: false });
	});

	it('declares its settings, so settings search finds them', async function () {
		const result = await browser.executeObsidian(async ({ app }) => {
			type Setting = { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } };
			const setting = (app as unknown as { setting: Setting }).setting;
			setting.open();
			setting.openTabById('inference-machine');
			const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
			await wait(600);
			const tab = setting.activeTab!.containerEl;
			const doc = tab.ownerDocument;
			const names = [...tab.querySelectorAll('.setting-item-name')].map((e) => e.textContent ?? '');
			const found: Record<string, boolean> = {};
			const search = doc.querySelector<HTMLInputElement>('input[type="search"]');
			for (const query of ['Detect LM Studio', 'Tag format', 'Properties not to copy']) {
				if (!search) break;
				search.value = query;
				search.dispatchEvent(new Event('input', { bubbles: true }));
				await wait(700);
				found[query] = [...doc.querySelectorAll('.setting-item-name')].some((e) => e.textContent === query);
			}
			// The exclude list is typed as text and stored as a list.
			const settingsTab = setting.activeTab as unknown as { getControlValue(key: string): unknown; setControlValue(key: string, value: unknown): Promise<void> };
			const before = settingsTab.getControlValue('excludedProperties');
			await settingsTab.setControlValue('excludedProperties', ' type, , aliases ');
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { data: { globalSettings: { excludedProperties: string[] } } } }> } }).plugins.plugins[
				'inference-machine'
			]!;
			const saved = [...plugin.store.data.globalSettings.excludedProperties];
			await settingsTab.setControlValue('excludedProperties', before);
			setting.close();
			return { names, found, before, saved };
		});
		expect(result.names).toEqual(
			expect.arrayContaining([
				'Engines',
				'Mock (default)',
				'Templates',
				'Comprehensive summary',
				'Output defaults',
				'Carry over from the source',
				'Carry leading images',
				'Copy the source\'s frontmatter',
				'Properties not to copy',
				'Tag defaults',
				'Network use and privacy',
			]),
		);
		expect(result.found).toEqual({ 'Detect LM Studio': true, 'Tag format': true, 'Properties not to copy': true });
		expect(result.before).toBe('aliases, cssclasses');
		expect(result.saved).toEqual(['type', 'aliases']);
	});

	it('falls back to a non-streaming request when the server blocks CORS', async function () {
		await reset(snapshot, 'no-cors');
		await openNote('Alpha.md');
		await openPopup();
		await runToPreview();
		await expect(popup().$('.cm-content')).toHaveText(expect.stringContaining('The team plans to ship the beta next week.'));
		await expect(popup().$('.im-warnings')).toHaveText(expect.stringContaining('CORS'));
	});
});
