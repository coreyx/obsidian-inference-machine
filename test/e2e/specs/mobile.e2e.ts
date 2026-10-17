import { browser, expect } from '@wdio/globals';
import { isMobileRun, openNote, openPopup, popup, popupButton, readFile, reset, runToPreview, snapshotData } from '../helpers';

/** The core flow under Obsidian's mobile emulation (REQ-17). */
describe('Inference Machine on mobile', function () {
	let snapshot: string;

	before(async function () {
		if (!isMobileRun()) this.skip();
		snapshot = await snapshotData();
	});

	beforeEach(async function () {
		await reset(snapshot);
		await openNote('Alpha.md');
	});

	it('opens, runs, previews and saves (17.1)', async function () {
		await openPopup();
		await expect(popup()).toHaveElementClass('im-mobile');
		await runToPreview();
		await popupButton('Save').click();
		await browser.waitUntil(async () => (await readFile('Alpha - Comprehensive summary.md')) !== null, { timeout: 30000 });
	});

	it('replaces "Detect LM Studio" with an explanation (17.2)', async function () {
		const detect = await browser.executeObsidian(async ({ app }) => {
			type Setting = { open(): void; close(): void; openTabById(id: string): void; activeTab?: { containerEl: HTMLElement } };
			const setting = (app as unknown as { setting: Setting }).setting;
			setting.open();
			setting.openTabById('inference-machine');
			await new Promise((r) => window.setTimeout(r, 500));
			const row = [...(setting.activeTab?.containerEl.querySelectorAll('.setting-item') ?? [])].find(
				(e) => e.querySelector('.setting-item-name')?.textContent === 'Detect LM Studio',
			);
			const result = { text: row?.textContent ?? '', buttons: row?.querySelectorAll('button').length ?? -1 };
			setting.close();
			return result;
		});
		expect(detect.text).toContain('Not available on mobile');
		expect(detect.buttons).toBe(0);
	});
});
