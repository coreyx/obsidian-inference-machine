import { Notice, Platform, PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { DEFAULTS } from '../core/defaults';
import type { EngineConfig, GlobalSettings, TagFormat } from '../core/schema';
import { duplicateTemplate, restoreBuiltIns } from '../core/templates';
import type { Engine } from '../engines/engine';
import { isLocalEngine } from '../engines/factory';
import type { Http } from '../engines/transport';
import type { SettingsStore } from '../obsidian/settings-store';
import { confirmAction } from './confirm-modals';
import { runLmStudioDetection } from './detect-flow';
import { EngineModal, PROVIDER_LABELS } from './engine-modal';
import { FolderSuggest } from './suggesters';
import { formatLabel, TemplateEditorModal } from './template-editor';

/** What the settings tab needs from the plugin. */
export interface SettingsContext {
	app: App;
	plugin: Plugin;
	store: SettingsStore;
	http: Http;
	engineFor: (config: EngineConfig) => Engine;
	newId: () => string;
	/** Adds the template import and export controls (REQ-20). */
	renderTemplateTransfer?: (container: HTMLElement, refresh: () => void) => void;
}

/**
 * The plugin's settings (design.md, "SettingsTab sections"): engines,
 * templates, output defaults, tagging defaults, and the network-use
 * disclosure (18.0.5).
 */
export class InferenceMachineSettingTab extends PluginSettingTab {
	private detectMessage = '';

	constructor(private readonly ctx: SettingsContext) {
		super(ctx.app, ctx.plugin);
	}

	display(): void {
		const el = this.containerEl;
		el.empty();
		this.renderEngines(el);
		this.renderTemplates(el);
		this.renderOutputDefaults(el);
		this.renderTaggingDefaults(el);
		this.renderAbout(el);
	}

	private async saveGlobal(change: (global: GlobalSettings) => void, redraw = false): Promise<void> {
		await this.ctx.store.update((data) => change(data.globalSettings));
		if (redraw) this.refresh();
	}

	/**
	 * Redraws the tab. `display` is deprecated from Obsidian 1.13 in favor of
	 * declarative settings, but the plugin supports 1.11.4, which only has `display`.
	 */
	private refresh(): void {
		this.display();
	}

	// --- Engines ---------------------------------------------------------

	private renderEngines(el: HTMLElement): void {
		const { store } = this.ctx;
		new Setting(el).setName('Engines').setDesc('Set up an AI engine once, then use it with any template.').setHeading();

		for (const engine of store.data.engines) {
			const isDefault = engine.id === store.data.defaultEngineId;
			const window =
				engine.contextWindow !== undefined
					? `context window ${engine.contextWindow.toLocaleString()} tokens`
					: 'context window unknown, so long notes can\'t be flagged';
			const setting = new Setting(el)
				.setName(`${engine.name}${isDefault ? ' (default)' : ''}`)
				.setDesc(`${PROVIDER_LABELS[engine.provider]} · ${engine.model} · ${isLocalEngine(engine) ? 'local' : 'remote'} · ${window}`);
			setting.addButton((b) =>
				b.setButtonText('Test').onClick(async () => {
					b.setDisabled(true);
					try {
						await this.ctx.engineFor(engine).test();
						new Notice(`${engine.name} works.`);
					} catch (error) {
						new Notice(`${engine.name}: ${error instanceof Error ? error.message : String(error)}`, 10000);
					}
					b.setDisabled(false);
				}),
			);
			if (!isDefault) {
				setting.addButton((b) =>
					b.setButtonText('Make default').onClick(async () => {
						await store.update((data) => (data.defaultEngineId = engine.id));
						this.refresh();
					}),
				);
			}
			setting.addExtraButton((b) =>
				b
					.setIcon('pencil')
					.setTooltip('Edit')
					.onClick(() => new EngineModal(this.ctx, engine, () => this.refresh()).open()),
			);
			setting.addExtraButton((b) =>
				b
					.setIcon('trash-2')
					.setTooltip('Delete')
					.onClick(async () => {
						const ok = await confirmAction(
							this.app,
							`Delete "${engine.name}"?`,
							'Templates that use this engine will use the default engine instead. Its API key stays in Obsidian\'s secret storage.',
							'Delete',
						);
						if (!ok) return;
						await store.update((data) => {
							data.engines = data.engines.filter((e) => e.id !== engine.id);
							if (data.defaultEngineId === engine.id) data.defaultEngineId = data.engines[0]?.id;
						});
						this.refresh();
					}),
			);
		}

		new Setting(el).addButton((b) =>
			b
				.setButtonText('Add engine')
				.setCta()
				.onClick(() => new EngineModal(this.ctx, undefined, () => this.refresh()).open()),
		);

		// 4.0.6, 17.0.2: LM Studio runs on a computer, so a phone can't detect it.
		if (Platform.isMobile) {
			new Setting(el)
				.setName('Detect LM Studio')
				.setDesc(
					'Not available on mobile: LM Studio runs on a computer, so it can\'t be detected from here. To use it, add an OpenAI-compatible engine with your computer\'s network address.',
				);
			return;
		}
		let port = store.data.globalSettings.lmStudioPort;
		new Setting(el)
			.setName('Detect LM Studio')
			.setDesc(this.detectMessage || 'Finds LM Studio\'s local server and sets up an engine for it.')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.inputEl.addClass('im-port');
				t.setPlaceholder(String(DEFAULTS.lmStudioPort))
					.setValue(String(port))
					.onChange((v) => {
						const n = Number(v);
						if (Number.isInteger(n) && n > 0 && n <= 65535) port = n;
					});
			})
			.addButton((b) =>
				b.setButtonText('Detect').onClick(async () => {
					b.setDisabled(true);
					await this.saveGlobal((global) => (global.lmStudioPort = port));
					const outcome = await runLmStudioDetection({ app: this.app, http: this.ctx.http, store }, port);
					this.detectMessage = outcome.message;
					this.refresh();
				}),
			);
	}

	// --- Templates -------------------------------------------------------

	private renderTemplates(el: HTMLElement): void {
		const { store } = this.ctx;
		new Setting(el).setName('Templates').setDesc('Each template defines a prompt and the note it produces, and gets its own command.').setHeading();

		for (const template of store.data.templates) {
			const engine = store.data.engines.find((e) => e.id === template.engineId);
			const details = [template.origin ? 'built-in' : undefined, engine ? `uses ${engine.name}` : undefined].filter(Boolean).join(' · ');
			new Setting(el)
				.setName(template.name)
				.setDesc(details)
				.addButton((b) => b.setButtonText('Edit').onClick(() => new TemplateEditorModal(this.app, store, template, () => this.refresh()).open()))
				.addExtraButton((b) =>
					b
						.setIcon('copy')
						.setTooltip('Duplicate')
						.onClick(async () => {
							// 15.0.3: an editable copy; the original stays.
							await store.update((data) => {
								data.templates.push(duplicateTemplate(template, this.ctx.newId(), data.templates.map((t) => t.name)));
							});
							this.refresh();
						}),
				)
				.addExtraButton((b) =>
					b
						.setIcon('trash-2')
						.setTooltip('Delete')
						.onClick(async () => {
							const restorable = template.origin ? ' Built-in templates can be restored later.' : '';
							if (!(await confirmAction(this.app, `Delete "${template.name}"?`, `Its "Derive with" command is removed too.${restorable}`, 'Delete'))) return;
							await store.update((data) => (data.templates = data.templates.filter((t) => t.id !== template.id)));
							this.refresh();
						}),
				);
		}

		const actions = new Setting(el)
			.addButton((b) =>
				b
					.setButtonText('New template')
					.setCta()
					.onClick(() => {
						const name = 'New template';
						new TemplateEditorModal(this.app, store, { id: this.ctx.newId(), name, prompt: '' }, () => this.refresh()).open();
					}),
			)
			.addButton((b) =>
				b.setButtonText('Restore built-in templates').onClick(async () => {
					let restored: string[] = [];
					await store.update((data) => {
						const result = restoreBuiltIns(data.templates, this.ctx.newId);
						data.templates = result.templates;
						restored = result.restored;
					});
					new Notice(restored.length === 0 ? 'All built-in templates are already here.' : `Restored: ${restored.join(', ')}.`);
					this.refresh();
				}),
			);
		this.ctx.renderTemplateTransfer?.(actions.controlEl, () => this.refresh());
	}

	// --- Defaults --------------------------------------------------------

	private renderOutputDefaults(el: HTMLElement): void {
		const global = this.ctx.store.data.globalSettings;
		new Setting(el).setName('Output defaults').setDesc('Used by every template that doesn\'t set its own.').setHeading();

		const location = new Setting(el).setName('Location');
		location.addDropdown((d) =>
			d
				.addOption('alongside', 'Next to the source note')
				.addOption('folder', 'In a folder')
				.setValue(global.location.mode)
				.onChange((mode) => void this.saveGlobal((g) => (g.location = mode === 'folder' ? { mode: 'folder', path: '' } : { mode: 'alongside' }), true)),
		);
		if (global.location.mode === 'folder') {
			const current = global.location;
			location.addText((t) => {
				t.setPlaceholder('Folder').setValue(current.path);
				const set = (path: string) => void this.saveGlobal(() => (current.path = path));
				t.onChange(set);
				new FolderSuggest(this.app, t.inputEl, set);
			});
		}

		new Setting(el)
			.setName('Filename')
			.setDesc('Variables work here, as in templates.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULTS.noteNameFormat)
					.setValue(global.noteNameFormat ?? '')
					.onChange((v) =>
						void this.saveGlobal((g) => {
							if (v.trim() === '') delete g.noteNameFormat;
							else g.noteNameFormat = v;
						}),
					),
			);
		new Setting(el)
			.setName('Link back to the source')
			.setDesc('Add a link to the source note under a references heading.')
			.addToggle((t) => t.setValue(global.references.enabled).onChange((v) => void this.saveGlobal((g) => (g.references.enabled = v))));
		new Setting(el)
			.setName('References heading')
			.setDesc('Created at the end of the note when the note doesn\'t already have it.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULTS.references.heading)
					.setValue(global.references.heading)
					.onChange((v) => void this.saveGlobal((g) => (g.references.heading = v.trim() === '' ? DEFAULTS.references.heading : v.trim()))),
			);
		new Setting(el)
			.setName('Open the new note')
			.addToggle((t) => t.setValue(global.openAfterCreate).onChange((v) => void this.saveGlobal((g) => (g.openAfterCreate = v))));
		new Setting(el)
			.setName('When the name is taken')
			.setDesc('A note is never overwritten.')
			.addDropdown((d) =>
				d
					.addOption('number', 'Add a number')
					.addOption('ask', 'Ask')
					.setValue(global.collision)
					.onChange((v) => void this.saveGlobal((g) => (g.collision = v === 'ask' ? 'ask' : 'number'))),
			);
	}

	private renderTaggingDefaults(el: HTMLElement): void {
		const tagging = this.ctx.store.data.globalSettings.tagging;
		new Setting(el).setName('Tag defaults').setDesc('Templates can override each of these.').setHeading();
		const toggle = (name: string, desc: string, key: 'mergeSourceTags' | 'aiTagging' | 'applyFormatToSource' | 'hierarchicalPrefixes' | 'reuseVaultTags' | 'existingOnly') =>
			new Setting(el)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) => t.setValue(tagging[key]).onChange((v) => void this.saveGlobal((g) => (g.tagging[key] = v))));

		toggle('Merge source tags', 'Carry the source note\'s frontmatter and inline tags into the new note.', 'mergeSourceTags');
		toggle('AI tagging', 'Ask the engine for tags in a separate request. Your vault\'s tags are sent with it when reuse is on.', 'aiTagging');

		const format = new Setting(el).setName('Tag format').setDesc('AI tags are converted to this format. Custom formats are described to the model in your words.');
		format.addDropdown((d) => {
			for (const value of ['kebab', 'snake', 'camel', 'pascal'] as const) d.addOption(value, formatLabel(value));
			d.addOption('custom', 'Custom');
			d.setValue(typeof tagging.format === 'object' ? 'custom' : tagging.format);
			d.onChange((v) => void this.saveGlobal((g) => (g.tagging.format = v === 'custom' ? { custom: 'lowercase words joined by hyphens' } : (v as TagFormat)), true));
		});
		if (typeof tagging.format === 'object') {
			const custom = tagging.format;
			format.addText((t) => t.setValue(custom.custom).onChange((v) => void this.saveGlobal(() => (custom.custom = v.trim() === '' ? custom.custom : v))));
		}
		toggle('Apply the format to source tags', 'Also convert the source note\'s tags. Off keeps them exactly as written.', 'applyFormatToSource');
		toggle('Hierarchical prefixes', 'Let AI tags use and create group prefixes such as ai/.', 'hierarchicalPrefixes');
		toggle('Reuse vault tags first', 'Send the vault\'s existing tags so the AI reuses them.', 'reuseVaultTags');
		toggle('Existing tags only', 'Discard AI tags that aren\'t already in the vault.', 'existingOnly');

		const count = (input: HTMLInputElement, value: number, set: (n: number) => void) => {
			input.type = 'number';
			input.min = '1';
			input.addClass('im-count');
			input.value = String(value);
			input.addEventListener('change', () => {
				const n = Number(input.value);
				if (Number.isInteger(n) && n >= 1) set(n);
			});
		};
		new Setting(el)
			.setName('Number of AI tags')
			.setDesc('The fewest and most tags to ask for.')
			.addText((t) => count(t.inputEl, tagging.minTags, (n) => void this.saveGlobal((g) => (g.tagging.minTags = n))))
			.addText((t) => count(t.inputEl, tagging.maxTags, (n) => void this.saveGlobal((g) => (g.tagging.maxTags = n))));
	}

	// --- About -----------------------------------------------------------

	private renderAbout(el: HTMLElement): void {
		new Setting(el).setName('Network use and privacy').setHeading();
		// 18.0.5: the disclosure Obsidian's plugin guidelines require.
		const about = el.createDiv({ cls: 'setting-item-description im-about' });
		about.createEl('p', {
			text: 'When you run a template, the source note\'s filename and contents, including its frontmatter, are sent to the engine you choose, and to no other service. With AI tagging on, your vault\'s tag names are sent too. Remote engines are run by their providers (Anthropic, OpenAI, Google, or the server you configure), under their terms. Local engines, such as LM Studio, keep the note on your device or network.',
		});
		about.createEl('p', {
			text: 'API keys are kept in Obsidian\'s secret storage, never in this plugin\'s settings file, and never written into notes or error messages. Secret storage stays on each device, so enter your keys again on each device you use.',
		});
	}
}
