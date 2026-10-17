import { Modal, Notice, Platform, Setting, type App } from 'obsidian';
import { exportTemplates, importTemplates } from '../core/template-transfer';
import type { SettingsStore } from '../obsidian/settings-store';

/**
 * Template import and export (REQ-20). Export copies a template file to the
 * clipboard, or on desktop downloads it, so no JSON file has to live in the
 * vault. Import reads a chosen file or pasted text.
 */

/** Picks which templates to export, then copies or downloads the file (20.0.1). */
export class ExportModal extends Modal {
	private readonly chosen = new Set<string>();

	constructor(
		app: App,
		private readonly store: SettingsStore,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('inference-machine-settings-modal');
		this.setTitle('Export templates');
		const el = this.contentEl;
		el.createEl('p', { text: 'The file holds the chosen templates only. Engines are named, but no API key or other credential is ever included.' });
		for (const template of this.store.data.templates) {
			this.chosen.add(template.id);
			new Setting(el).setName(template.name).addToggle((t) =>
				t.setValue(true).onChange((on) => {
					if (on) this.chosen.add(template.id);
					else this.chosen.delete(template.id);
				}),
			);
		}
		const actions = new Setting(el).addButton((b) => b.setButtonText('Copy to clipboard').onClick(() => void this.copy()));
		// Mobile webviews don't reliably save a downloaded file, so mobile copies instead (REQ-17).
		if (!Platform.isMobile) {
			actions.addButton((b) =>
				b
					.setButtonText('Download file')
					.setCta()
					.onClick(() => this.download()),
			);
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private file(): string | undefined {
		const templates = this.store.data.templates.filter((t) => this.chosen.has(t.id));
		if (templates.length === 0) {
			new Notice('Choose at least one template to export.');
			return undefined;
		}
		return exportTemplates(templates, this.store.data.engines);
	}

	private async copy(): Promise<void> {
		const text = this.file();
		if (!text) return;
		await navigator.clipboard.writeText(text);
		new Notice('Templates copied to the clipboard.');
		this.close();
	}

	private download(): void {
		const text = this.file();
		if (!text) return;
		const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
		const link = this.contentEl.createEl('a', { attr: { href: url, download: 'inference-machine-templates.json' } });
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		this.close();
	}
}

/** Reads a template file and adds its templates (20.0.2), or explains why it can't (20.0.5). */
export class ImportModal extends Modal {
	private text = '';
	private status!: HTMLElement;

	constructor(
		app: App,
		private readonly store: SettingsStore,
		private readonly newId: () => string,
		private readonly onImported: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('inference-machine-settings-modal');
		this.setTitle('Import templates');
		const el = this.contentEl;
		el.createEl('p', { text: 'Choose an Inference Machine template file, or paste its contents.' });

		new Setting(el).setName('File').addButton((b) =>
			b.setButtonText('Choose file').onClick(() => {
				const input = el.createEl('input', { attr: { type: 'file', accept: '.json,application/json' } });
				input.addClass('im-hidden');
				input.addEventListener('change', () => {
					const file = input.files?.[0];
					if (file) void file.text().then((text) => this.import(text));
					input.remove();
				});
				input.click();
			}),
		);
		new Setting(el).setName('Or paste').addTextArea((t) => {
			t.inputEl.rows = 8;
			t.inputEl.addClass('im-import-text');
			t.onChange((v) => (this.text = v));
		});
		this.status = el.createDiv({ attr: { role: 'alert' } });
		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText('Import')
					.setCta()
					.onClick(() => void this.import(this.text)),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private async import(text: string): Promise<void> {
		const data = this.store.data;
		const result = importTemplates(text, data.templates, data.engines, this.newId);
		if (!result.ok) {
			this.status.setText(result.error);
			this.status.addClass('im-error');
			return;
		}
		await this.store.update((d) => d.templates.push(...result.templates));
		new Notice(`Imported ${result.templates.map((t) => `"${t.name}"`).join(', ')}.`);
		this.onImported();
		this.close();
	}
}
