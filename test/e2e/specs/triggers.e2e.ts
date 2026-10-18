import { $, browser, expect } from '@wdio/globals';
import { isMobileRun, openNote, openPopup, popup, popupButton, reset, snapshotData } from '../helpers';

/** The id of a template, by name. */
async function templateId(name: string): Promise<string> {
	return browser.executeObsidian(({ app }, wanted) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { store: { data: { templates: { id: string; name: string }[] } } }> } }).plugins.plugins['inference-machine']!;
		return plugin.store.data.templates.find((t) => t.name === wanted)!.id;
	}, name);
}

/** The template dropdown's selected template id, once trigger matching has settled. */
async function selectedTemplate(): Promise<string> {
	await browser.pause(400);
	return popup().$('select').getValue();
}

/** Template triggers (REQ-22). */
describe('Template triggers', function () {
	let snapshot: string;

	before(async function () {
		if (isMobileRun()) this.skip();
		snapshot = await snapshotData();
	});

	it('preselects a template whose folder trigger matches, and says so (22.1, 22.7)', async function () {
		await reset(snapshot, 'cors', { template: { name: 'Action items', changes: { triggers: ['folder:Meetings'] } } });
		await openNote('Meetings/2026-10-01.md');
		await openPopup();
		expect(await selectedTemplate()).toBe(await templateId('Action items'));
		await expect(popup()).toHaveText(expect.stringContaining('Matched folder:Meetings'));

		await browser.keys('Escape');
		await openNote('Alpha.md');
		await openPopup();
		expect(await selectedTemplate()).not.toBe(await templateId('Action items'));
		await expect(popup()).not.toHaveText(expect.stringContaining('Matched'));
	});

	it('uses the first matching template in list order, so reordering changes it (22.5)', async function () {
		const both = [
			{ name: 'Key points / TL;DR', changes: { triggers: ['#reading'] } },
			{ name: 'Flashcards', changes: { triggers: ['#reading'] } },
		];
		await reset(snapshot, 'cors', { templates: both });
		await openNote('Alpha.md');
		await openPopup();
		expect(await selectedTemplate()).toBe(await templateId('Key points / TL;DR'));

		await reset(snapshot, 'cors', { templates: both, order: ['Flashcards'] });
		await openNote('Alpha.md');
		await openPopup();
		expect(await selectedTemplate()).toBe(await templateId('Flashcards'));
	});

	it('lets a "Derive with" command win over a matching trigger (22.6)', async function () {
		await reset(snapshot, 'cors', { template: { name: 'Action items', changes: { triggers: ['folder:Meetings'] } } });
		await openNote('Meetings/2026-10-01.md');
		const literature = await templateId('Literature note');
		await browser.executeObsidianCommand(`inference-machine:derive-${literature}`);
		await popup().waitForExist();
		expect(await selectedTemplate()).toBe(literature);
	});

	it('skips an invalid expression and still matches the other triggers (22.8)', async function () {
		await reset(snapshot, 'cors', { template: { name: 'Flashcards', changes: { triggers: ['title:/[/', '#reading'] } } });
		await openNote('Alpha.md');
		await openPopup();
		expect(await selectedTemplate()).toBe(await templateId('Flashcards'));
		await expect(popup()).toHaveText(expect.stringContaining('Matched #reading'));
	});

	it('re-applies triggers when the source changes, until a template is picked (22.9)', async function () {
		await reset(snapshot, 'cors', { template: { name: 'Action items', changes: { triggers: ['folder:Meetings'] } } });
		await openNote('Alpha.md');
		await openPopup();
		const chooseSource = async (query: string) => {
			await popupButton('Change').click();
			const input = $('.prompt .prompt-input');
			await input.waitForExist();
			await input.setValue(query);
			await browser.pause(300);
			await browser.keys('Enter');
			await browser.pause(300);
		};
		await chooseSource('2026-10-01');
		expect(await selectedTemplate()).toBe(await templateId('Action items'));

		// The user picks a template themselves; a new source note keeps it.
		await popup().$('select').selectByVisibleText('Flashcards');
		await chooseSource('Alpha');
		expect(await selectedTemplate()).toBe(await templateId('Flashcards'));
	});
});
