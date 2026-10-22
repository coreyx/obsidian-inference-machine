import { Notice, Platform, PluginSettingTab, type App, type Plugin, type SettingDefinitionItem, type SettingGroupItem } from 'obsidian';
import { DEFAULTS } from '../core/defaults';
import type { EngineConfig, GlobalSettings, TagFormat } from '../core/schema';
import { duplicateTemplate, restoreBuiltIns } from '../core/templates';
import type { Engine } from '../engines/engine';
import { isLocalEngine } from '../engines/factory';
import type { Http } from '../engines/transport';
import type { SettingsStore } from '../obsidian/settings-store';
import type { LmStudioControl } from '../run/run-controller';
import { confirmAction } from './confirm-modals';
import { runLmStudioDetection } from './detect-flow';
import { EngineModal, PROVIDER_LABELS } from './engine-modal';
import { formatLabel, TemplateEditorModal } from './template-editor';

/** What the settings tab needs from the plugin. */
export interface SettingsContext {
	app: App;
	plugin: Plugin;
	store: SettingsStore;
	http: Http;
	engineFor: (config: EngineConfig) => Engine;
	newId: () => string;
	/** LM Studio's native API, for the engine form (4.0.9). */
	lmStudio?: LmStudioControl;
	/** Adds the template import and export buttons (REQ-20) to a row. */
	renderTemplateTransfer?: (container: HTMLElement, refresh: () => void) => void;
}

const NAMED_FORMATS = ['kebab', 'snake', 'camel', 'pascal'] as const;
const TAGGING_TOGGLES = ['mergeSourceTags', 'aiTagging', 'applyFormatToSource', 'hierarchicalPrefixes', 'reuseVaultTags', 'existingOnly'] as const;

/**
 * The plugin's settings (design.md, "SettingsTab sections"), declared with
 * Obsidian's settings definitions (1.13) so that Obsidian's settings search
 * finds every one of them: engines, templates, output defaults, tag
 * defaults, and the network-use disclosure (18.0.5).
 *
 * Plain controls are stored in the global config through
 * `getControlValue` / `setControlValue`; their keys name a field of
 * `GlobalSettings`, with `tagging.` and `references.` for nested ones.
 */
export class InferenceMachineSettingTab extends PluginSettingTab {
	private detectMessage = '';
	/** True while this tab's own control is saving, so the change listener doesn't re-render under the user's cursor. */
	private savingControl = false;

	constructor(private readonly ctx: SettingsContext) {
		super(ctx.app, ctx.plugin);
		// Engines and templates also change outside this tab (the detect flow, imports, the popup),
		// and the definitions are computed ahead of time, so rebuild them when settings change.
		ctx.plugin.register(
			ctx.store.onChange(() => {
				if (!this.savingControl) this.refresh();
			}),
		);
	}

	/**
	 * Rebuilds the tab after engines, templates or other definitions change,
	 * keeping the scroll position: a full rebuild otherwise jumps back to the
	 * top whenever a button is pressed.
	 */
	private refresh(): void {
		const scroller = this.containerEl;
		const top = scroller.scrollTop;
		this.update();
		scroller.scrollTop = top;
		window.requestAnimationFrame(() => (scroller.scrollTop = top));
	}

	private get settings(): GlobalSettings {
		return this.ctx.store.data.globalSettings;
	}

	override getControlValue(key: string): unknown {
		const g = this.settings;
		switch (key) {
			case 'location.mode':
				return g.location.mode;
			case 'location.path':
				return g.location.mode === 'folder' ? g.location.path : '';
			case 'noteNameFormat':
				return g.noteNameFormat ?? '';
			case 'references.enabled':
				return g.references.enabled;
			case 'references.heading':
				return g.references.heading;
			case 'openAfterCreate':
				return g.openAfterCreate;
			case 'carryImages':
				return g.carryImages;
			case 'carryProperties':
				return g.carryProperties;
			case 'excludedProperties':
				return g.excludedProperties.join(', ');
			case 'collision':
				return g.collision;
			case 'tagging.format':
				return typeof g.tagging.format === 'object' ? 'custom' : g.tagging.format;
			case 'tagging.custom':
				return typeof g.tagging.format === 'object' ? g.tagging.format.custom : '';
			case 'tagging.minTags':
				return g.tagging.minTags;
			case 'tagging.maxTags':
				return g.tagging.maxTags;
		}
		const toggle = TAGGING_TOGGLES.find((name) => key === `tagging.${name}`);
		return toggle ? g.tagging[toggle] : undefined;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		let structural = false;
		this.savingControl = true;
		try {
			await this.saveControl(key, value, () => (structural = true));
		} finally {
			this.savingControl = false;
		}
		// Choices that show or hide another setting re-evaluate the visibility rules.
		if (structural) this.refreshDomState();
	}

	/** Writes one control's value into the global config. */
	private async saveControl(key: string, value: unknown, markStructural: () => void): Promise<void> {
		await this.ctx.store.update(({ globalSettings: g }) => {
			switch (key) {
				case 'location.mode':
					g.location = value === 'folder' ? { mode: 'folder', path: '' } : { mode: 'alongside' };
					markStructural();
					return;
				case 'location.path':
					if (g.location.mode === 'folder') g.location.path = String(value).trim();
					return;
				case 'noteNameFormat':
					if (String(value).trim() === '') delete g.noteNameFormat;
					else g.noteNameFormat = String(value);
					return;
				case 'references.enabled':
					g.references.enabled = value === true;
					return;
				case 'references.heading':
					g.references.heading = String(value).trim() || DEFAULTS.references.heading;
					return;
				case 'openAfterCreate':
					g.openAfterCreate = value === true;
					return;
				case 'carryImages':
					g.carryImages = value === true;
					return;
				case 'carryProperties':
					g.carryProperties = value === true;
					markStructural();
					return;
				case 'excludedProperties':
					// An empty field is a deliberate "copy everything", so it's saved as an empty list.
					g.excludedProperties = String(value)
						.split(',')
						.map((name) => name.trim())
						.filter((name) => name !== '');
					return;
				case 'collision':
					g.collision = value === 'ask' ? 'ask' : 'number';
					return;
				case 'tagging.format':
					g.tagging.format = value === 'custom' ? { custom: 'lowercase words joined by hyphens' } : (value as TagFormat);
					markStructural();
					return;
				case 'tagging.custom':
					if (typeof g.tagging.format === 'object' && String(value).trim() !== '') g.tagging.format = { custom: String(value) };
					return;
				case 'tagging.minTags':
				case 'tagging.maxTags': {
					const n = Number(value);
					if (Number.isInteger(n) && n >= 1) g.tagging[key === 'tagging.minTags' ? 'minTags' : 'maxTags'] = n;
					return;
				}
			}
			const toggle = TAGGING_TOGGLES.find((name) => key === `tagging.${name}`);
			if (toggle) g.tagging[toggle] = value === true;
		});
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			this.engineList(),
			this.lmStudioGroup(),
			this.templateList(),
			this.templateActions(),
			this.outputDefaults(),
			this.carryOverDefaults(),
			this.tagDefaults(),
			this.about(),
		];
	}

	// --- Engines ---------------------------------------------------------

	private engineList(): SettingDefinitionItem {
		const { store } = this.ctx;
		const engines = store.data.engines;
		return {
			type: 'list',
			heading: 'Engines',
			emptyState: 'No engines yet. Add one to start deriving notes.',
			addItem: { name: 'Add engine', action: () => new EngineModal(this.ctx, undefined, () => this.refresh()).open() },
			onDelete: (index) => void this.deleteEngine(engines[index]),
			items: engines.map((engine): SettingGroupItem => {
				const isDefault = engine.id === store.data.defaultEngineId;
				const window =
					engine.contextWindow !== undefined
						? `context window ${engine.contextWindow.toLocaleString()} tokens`
						: 'context window unknown, so long notes can\'t be flagged';
				return {
					name: `${engine.name}${isDefault ? ' (default)' : ''}`,
					desc: `${PROVIDER_LABELS[engine.provider]} · ${engine.model} · ${isLocalEngine(engine) ? 'local' : 'remote'} · ${window}`,
					aliases: [engine.model, PROVIDER_LABELS[engine.provider]],
					render: (setting) => {
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
					},
				};
			}),
		};
	}

	private async deleteEngine(engine: EngineConfig | undefined): Promise<void> {
		if (engine) {
			const ok = await confirmAction(
				this.app,
				`Delete "${engine.name}"?`,
				'Templates that use this engine will use the default engine instead. Its API key stays in Obsidian\'s secret storage.',
				'Delete',
			);
			if (ok) {
				await this.ctx.store.update((data) => {
					data.engines = data.engines.filter((e) => e.id !== engine.id);
					if (data.defaultEngineId === engine.id) data.defaultEngineId = data.engines[0]?.id;
				});
			}
		}
		this.refresh();
	}

	private lmStudioGroup(): SettingDefinitionItem {
		// 4.0.6, 17.0.2: LM Studio runs on a computer, so a phone can't detect it.
		if (Platform.isMobile) {
			return {
				type: 'group',
				items: [
					{
						name: 'Detect LM Studio',
						desc: 'Not available on mobile: LM Studio runs on a computer, so it can\'t be detected from here. To use it, add an OpenAI-compatible engine with your computer\'s network address.',
					},
				],
			};
		}
		return {
			type: 'group',
			items: [
				{
					name: 'Detect LM Studio',
					desc: this.detectMessage || 'Finds LM Studio\'s local server and sets up an engine for it.',
					aliases: ['local model', 'LM Studio port'],
					render: (setting) => {
						let port = this.settings.lmStudioPort;
						setting
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
									await this.ctx.store.update((data) => (data.globalSettings.lmStudioPort = port));
									const outcome = await runLmStudioDetection({ app: this.app, http: this.ctx.http, store: this.ctx.store }, port);
									this.detectMessage = outcome.message;
									this.refresh();
								}),
							);
					},
				},
			],
		};
	}

	// --- Templates -------------------------------------------------------

	private templateList(): SettingDefinitionItem {
		const { store } = this.ctx;
		const templates = store.data.templates;
		return {
			type: 'list',
			heading: 'Templates',
			emptyState: 'No templates. Create one, or restore the built-in templates.',
			addItem: {
				name: 'New template',
				action: () => new TemplateEditorModal(this.app, store, { id: this.ctx.newId(), name: 'New template', prompt: '' }, () => this.refresh()).open(),
			},
			onDelete: (index) => void this.deleteTemplate(index),
			// 22.0.8: the list order is the order triggers are matched in.
			onReorder: (from, to) =>
				void this.ctx.store
					.update((data) => {
						const [moved] = data.templates.splice(from, 1);
						if (moved) data.templates.splice(to, 0, moved);
					})
					.then(() => this.refresh()),
			items: templates.map((template): SettingGroupItem => {
				const engine = store.data.engines.find((e) => e.id === template.engineId);
				const triggers = template.triggers?.length ?? 0;
				const details = [
					template.origin ? 'built-in' : undefined,
					engine ? `uses ${engine.name}` : undefined,
					triggers > 0 ? `${triggers} ${triggers === 1 ? 'trigger' : 'triggers'}` : undefined,
				]
					.filter(Boolean)
					.join(' · ');
				return {
					name: template.name,
					desc: details,
					render: (setting) => {
						setting
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
							);
					},
				};
			}),
		};
	}

	private async deleteTemplate(index: number): Promise<void> {
		const template = this.ctx.store.data.templates[index];
		if (template) {
			const restorable = template.origin ? ' Built-in templates can be restored later.' : '';
			if (await confirmAction(this.app, `Delete "${template.name}"?`, `Its "Derive with" command is removed too.${restorable}`, 'Delete')) {
				await this.ctx.store.update((data) => (data.templates = data.templates.filter((t) => t.id !== template.id)));
			}
		}
		this.refresh();
	}

	private templateActions(): SettingDefinitionItem {
		return {
			type: 'group',
			items: [
				{
					name: 'Restore, import and export templates',
					desc: 'Bring back deleted built-in templates, or move templates between vaults as files. Exported files never contain API keys.',
					aliases: ['built-in templates', 'import templates', 'export templates', 'backup'],
					render: (setting) => {
						setting.addButton((b) =>
							b.setButtonText('Restore built-in templates').onClick(async () => {
								let restored: string[] = [];
								await this.ctx.store.update((data) => {
									const result = restoreBuiltIns(data.templates, this.ctx.newId);
									data.templates = result.templates;
									restored = result.restored;
								});
								new Notice(restored.length === 0 ? 'All built-in templates are already here.' : `Restored: ${restored.join(', ')}.`);
								this.refresh();
							}),
						);
						this.ctx.renderTemplateTransfer?.(setting.controlEl, () => this.refresh());
					},
				},
			],
		};
	}

	// --- Defaults --------------------------------------------------------

	private outputDefaults(): SettingDefinitionItem {
		const isFolder = () => this.settings.location.mode === 'folder';
		return {
			type: 'group',
			heading: 'Output defaults',
			items: [
				{
					name: 'Location',
					desc: 'Where new notes go, for every template that doesn\'t set its own.',
					control: { type: 'dropdown', key: 'location.mode', options: { alongside: 'Next to the source note', folder: 'In a folder' } },
				},
				{ name: 'Folder', visible: isFolder, control: { type: 'folder', key: 'location.path', placeholder: 'Folder', includeRoot: true } },
				{
					name: 'Filename',
					desc: 'Variables work here, as in templates.',
					control: { type: 'text', key: 'noteNameFormat', placeholder: DEFAULTS.noteNameFormat },
				},
				{ name: 'Link back to the source', desc: 'Add a link to the source note under a references heading.', control: { type: 'toggle', key: 'references.enabled' } },
				{
					name: 'References heading',
					desc: 'Created at the end of the note when the note doesn\'t already have it.',
					control: { type: 'text', key: 'references.heading', placeholder: DEFAULTS.references.heading },
				},
				{ name: 'Open the new note', control: { type: 'toggle', key: 'openAfterCreate' } },
				{
					name: 'When the name is taken',
					desc: 'A note is never overwritten.',
					control: { type: 'dropdown', key: 'collision', options: { number: 'Add a number', ask: 'Ask' } },
				},
			],
		};
	}

	/** What a derived note takes over from its source, for every template that doesn't say otherwise. */
	private carryOverDefaults(): SettingDefinitionItem {
		return {
			type: 'group',
			heading: 'Carry over from the source',
			items: [
				{
					name: 'Carry leading images',
					desc: 'Put the images at the front of the source note at the top of the new note. The images stay where they are; only the embeds are written.',
					control: { type: 'toggle', key: 'carryImages' },
				},
				{
					name: 'Copy the source\'s frontmatter',
					desc: 'Copy the source note\'s properties into the new note. Tags are merged separately. A template\'s own properties take priority.',
					control: { type: 'toggle', key: 'carryProperties' },
				},
				{
					name: 'Properties not to copy',
					desc: 'Comma-separated property names.',
					visible: () => this.settings.carryProperties,
					control: { type: 'text', key: 'excludedProperties', placeholder: 'aliases, cssclasses' },
				},
			],
		};
	}

	private tagDefaults(): SettingDefinitionItem {
		const isCustom = () => typeof this.settings.tagging.format === 'object';
		const options: Record<string, string> = Object.fromEntries(NAMED_FORMATS.map((f) => [f, formatLabel(f)]));
		options.custom = 'Custom';
		const count = (key: 'tagging.minTags' | 'tagging.maxTags', name: string, desc: string): SettingGroupItem => ({
			name,
			desc,
			control: { type: 'number', key, min: 1, step: 1, validate: (n) => (Number.isInteger(n) && n >= 1 ? undefined : 'Enter a whole number of at least 1.') },
		});
		return {
			type: 'group',
			heading: 'Tag defaults',
			items: [
				{ name: 'Merge source tags', desc: 'Carry the source note\'s frontmatter and inline tags into the new note.', control: { type: 'toggle', key: 'tagging.mergeSourceTags' } },
				{
					name: 'AI tagging',
					desc: 'Ask the engine for tags in a separate request. Your vault\'s tags are sent with it when reuse is on.',
					control: { type: 'toggle', key: 'tagging.aiTagging' },
				},
				{
					name: 'Tag format',
					desc: 'AI tags are converted to this format. Custom formats are described to the model in your words.',
					aliases: ['kebab-case', 'snake_case', 'camelCase', 'PascalCase'],
					control: { type: 'dropdown', key: 'tagging.format', options },
				},
				{ name: 'Custom tag format', visible: isCustom, control: { type: 'text', key: 'tagging.custom', placeholder: 'Describe the format' } },
				{
					name: 'Apply the format to source tags',
					desc: 'Also convert the source note\'s tags. Off keeps them exactly as written.',
					control: { type: 'toggle', key: 'tagging.applyFormatToSource' },
				},
				{ name: 'Hierarchical prefixes', desc: 'Let AI tags use and create group prefixes such as ai/.', control: { type: 'toggle', key: 'tagging.hierarchicalPrefixes' } },
				{ name: 'Reuse vault tags first', desc: 'Send the vault\'s existing tags so the AI reuses them.', control: { type: 'toggle', key: 'tagging.reuseVaultTags' } },
				{ name: 'Existing tags only', desc: 'Discard AI tags that aren\'t already in the vault.', control: { type: 'toggle', key: 'tagging.existingOnly' } },
				count('tagging.minTags', 'Fewest AI tags', 'The fewest tags to ask the AI for.'),
				count('tagging.maxTags', 'Most AI tags', 'AI tags beyond this number are left out.'),
			],
		};
	}

	// --- About -----------------------------------------------------------

	private about(): SettingDefinitionItem {
		return {
			type: 'group',
			heading: 'Network use and privacy',
			items: [
				{
					// 18.0.5: the disclosure Obsidian's plugin guidelines require.
					name: 'What leaves your device',
					desc: 'When you run a template, the source note\'s filename and contents, including its frontmatter, are sent to the engine you choose, and to no other service. With AI tagging on, your vault\'s tag names are sent too. Remote engines are run by their providers (Anthropic, OpenAI, Google, or the server you configure), under their terms. Local engines, such as LM Studio, keep the note on your device or network.',
				},
				{
					name: 'Where API keys are kept',
					desc: 'In Obsidian\'s secret storage, never in this plugin\'s settings file, and never in notes or error messages. Secret storage stays on each device, so enter your keys again on each device you use.',
				},
			],
		};
	}
}
