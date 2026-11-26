import { get } from 'node:http';
import { $, browser, expect } from '@wdio/globals';
import {
	isMobileRun,
	locationSelect,
	MOCK_URL,
	openNote,
	popup,
	popupButton,
	reset,
	runToPreview,
	snapshotData,
	templateId,
	waitForPopupSettled,
} from '../helpers';

/** The selected words in `Alpha.md`, and the rest of their line, which must not be sent. */
const SELECTED = 'A sample note';
const REST = 'for manual and end-to-end testing';

/** Shows `Alpha.md` in Source mode, so its lines are plain editor lines, and selects text at the start of its sample line. */
async function selectInAlpha(length = SELECTED.length): Promise<void> {
	await openNote('Alpha.md');
	await browser.executeObsidian(async ({ app, obsidian }, chars) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		await view.setState({ ...view.getState(), mode: 'source' }, { history: false });
		const editor = view.editor;
		const line = editor.getValue().split('\n').findIndex((l) => l.startsWith('A sample'));
		editor.focus();
		editor.setSelection({ line, ch: 0 }, { line, ch: chars });
	}, length);
	await browser.pause(200);
}

/** Right-clicks inside the selection, as a user does, and returns the editor menu's item titles. */
async function rightClickSelection(): Promise<string[]> {
	// The active pane's line: another tab can hold a hidden editor on the same note.
	const line = $('.workspace-leaf.mod-active').$(`.cm-line*=${SELECTED}`);
	await line.click({ button: 'right', x: -Math.round((await line.getSize('width')) / 2) + 20 });
	await $('.menu').waitForExist();
	return browser.execute(() => [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent ?? ''));
}

/** A menu item by its exact title, in the menu or an open submenu. */
const menuItem = (title: string) => $(`//div[contains(@class, "menu-item-title") and normalize-space() = "${title}"]`);

/** Clicks a menu item by its title. */
async function clickMenuItem(title: string): Promise<void> {
	const item = menuItem(title);
	await item.waitForDisplayed();
	await item.click();
}

/** The requests the mock server has received, read in the test runner. */
function mockRequests(): Promise<{ body?: { stream?: boolean; messages?: { role: string; content: string }[] } }[]> {
	return new Promise((resolve, reject) => {
		get(new URL('/__requests', MOCK_URL), (res) => {
			let text = '';
			res.setEncoding('utf8');
			res.on('data', (chunk: string) => (text += chunk));
			res.on('end', () => resolve(JSON.parse(text) as Awaited<ReturnType<typeof mockRequests>>));
		}).on('error', reject);
	});
}

/** The user message of the last main (streamed) request the mock server received. */
async function lastMainRequest(): Promise<string> {
	const requests = await mockRequests();
	const main = requests.filter((r) => r.body?.stream === true).pop();
	return main?.body?.messages?.find((m) => m.role === 'user')?.content ?? '';
}

/** Deriving a note from selected text (Q55 to Q57, Q64, Q65). */
describe('Deriving from selected text', function () {
	let snapshot: string;

	before(async function () {
		snapshot = await snapshotData();
	});

	beforeEach(async function () {
		await reset(snapshot);
	});

	it('offers the right-click items only while text is selected', async function () {
		if (isMobileRun()) this.skip();
		await selectInAlpha();
		const titles = await rightClickSelection();
		expect(titles).toContain('Derive from selection');
		expect(titles).toContain('Derive selection with');
		await browser.keys('Escape');

		await selectInAlpha(0);
		const none = await rightClickSelection();
		expect(none).not.toContain('Derive from selection');
		expect(none).not.toContain('Derive selection with');
		await browser.keys('Escape');
	});

	it('runs on the selection from "Derive from selection", or on the whole note after "Use whole note"', async function () {
		if (isMobileRun()) this.skip();
		await selectInAlpha();
		await rightClickSelection();
		await clickMenuItem('Derive from selection');
		await popup().waitForExist();
		await waitForPopupSettled();
		await expect(popup()).toHaveText(expect.stringContaining('Alpha.md · Selection only (3 words)'));

		await runToPreview();
		const sent = await lastMainRequest();
		expect(sent).toContain(`Selected text:\n\n${SELECTED}`);
		expect(sent).toContain('author: Ada');
		expect(sent).not.toContain(REST);
		await expect(popup().$('.cm-content')).toHaveText(expect.stringContaining('[[Alpha]]'));

		await reset(snapshot);
		await selectInAlpha();
		await rightClickSelection();
		await clickMenuItem('Derive from selection');
		await popup().waitForExist();
		await waitForPopupSettled();
		await popupButton('Use whole note').click();
		await expect(popup()).not.toHaveText(expect.stringContaining('Selection only'));
		await runToPreview();
		expect(await lastMainRequest()).toContain(`${SELECTED} ${REST}`);
	});

	it('runs a template straight away from the "Derive selection with" submenu, with its remembered folder', async function () {
		if (isMobileRun()) this.skip();
		const actionItems = await templateId('Action items');
		await browser.executeObsidian(async ({ app }, id) => {
			type Store = { update(fn: (d: { ui: { templateChoices?: Record<string, unknown> } }) => void): Promise<void> };
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: Store }> } }).plugins.plugins['inference-machine']!;
			await plugin.store.update((d) => (d.ui.templateChoices = { [id]: { location: { mode: 'folder', path: 'Out' } } }));
		}, actionItems);
		await selectInAlpha();
		await rightClickSelection();
		await menuItem('Derive selection with').moveTo();
		await clickMenuItem('Action items');
		// No Run click: the submenu starts the run itself.
		await popup().$('.im-path').waitForExist({ timeout: 30000 });
		await expect(popup().$('.im-path')).toHaveText('Saves to Out/Alpha - Action items.md');
		expect(await lastMainRequest()).not.toContain(REST);
	});

	it('offers the command only while text is selected, and opens selection mode', async function () {
		type Commands = { findCommand(id: string): { checkCallback?: (checking: boolean) => boolean | void } | undefined };
		// The check the command palette and hotkeys make: true when the command is offered.
		const offered = () =>
			browser.executeObsidian(({ app }) => (app as unknown as { commands: Commands }).commands.findCommand('inference-machine:derive-selection')?.checkCallback?.(true) === true);
		await selectInAlpha(0);
		expect(await offered()).toBe(false);

		await selectInAlpha();
		expect(await offered()).toBe(true);
		await browser.executeObsidianCommand('inference-machine:derive-selection');
		await popup().waitForExist();
		await waitForPopupSettled();
		await expect(popup()).toHaveText(expect.stringContaining('Selection only (3 words)'));
		await expect(locationSelect()).toExist();
	});
});
