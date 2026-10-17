import { Modal, Setting, type App } from 'obsidian';
import type { CollisionChoice, OversizedRequest } from '../run/run-controller';

/**
 * The run's two questions for the user: whether to send a note that looks
 * too long (16.0.2), and what to do when the output name is taken and
 * collisions are set to "ask" (10.0.4). Each resolves once, and closing the
 * modal counts as the safe answer: don't send, don't save.
 */

/** Asks whether to send a request that's estimated to be over the context window. */
export function confirmLongNote(app: App, oversized: OversizedRequest[]): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const answer = (value: boolean) => {
			if (answered) return;
			answered = true;
			resolve(value);
		};
		const modal = new Modal(app);
		modal.setTitle('This note may be too long for the model');
		for (const item of oversized) {
			modal.contentEl.createEl('p', {
				text: `The ${item.request === 'main' ? 'main request' : 'inline prompt request'} is about ${item.estimate.toLocaleString()} tokens, and the engine has room for about ${item.limit.toLocaleString()}.`,
			});
		}
		modal.contentEl.createEl('p', { text: 'The model may reject it or cut the note off. The note is never shortened before sending.' });
		new Setting(modal.contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					answer(false);
					modal.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText('Send anyway')
					.onClick(() => {
						answer(true);
						modal.close();
					}),
			);
		modal.onClose = () => answer(false);
		modal.open();
	});
}

/** Asks what to do when the planned note name is already taken. */
export function askCollision(app: App, takenPath: string): Promise<CollisionChoice> {
	return new Promise((resolve) => {
		let answered = false;
		const answer = (choice: CollisionChoice) => {
			if (answered) return;
			answered = true;
			resolve(choice);
		};
		const name = takenPath.split('/').pop()?.replace(/\.md$/u, '') ?? takenPath;
		let renamed = name;
		const modal = new Modal(app);
		modal.setTitle('A note with this name already exists');
		modal.contentEl.createEl('p', { text: `"${takenPath}" already exists. It won't be overwritten.` });
		new Setting(modal.contentEl).setName('New name').addText((text) => {
			text.setValue(name).onChange((value) => (renamed = value));
			text.inputEl.select();
		});
		new Setting(modal.contentEl)
			.addButton((b) =>
				b.setButtonText('Cancel').onClick(() => {
					answer({ action: 'cancel' });
					modal.close();
				}),
			)
			.addButton((b) =>
				b.setButtonText('Add a number').onClick(() => {
					answer({ action: 'number' });
					modal.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText('Use the new name')
					.setCta()
					.onClick(() => {
						answer({ action: 'rename', name: renamed.trim() === '' ? name : renamed });
						modal.close();
					}),
			);
		modal.onClose = () => answer({ action: 'cancel' });
		modal.open();
	});
}
