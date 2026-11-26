import { ButtonComponent, MenuItem, Notice, parseYaml, Plugin, stringifyYaml, type Editor, type MarkdownFileInfo, type Menu } from 'obsidian';
import type { EngineConfig } from './core/schema';
import { createEngine } from './engines/factory';
import type { Engine } from './engines/engine';
import { loadWithContextLength, readLoadedModel } from './engines/lmstudio';
import { obsidianHttp, resetStreamingBlocked } from './engines/transport';
import { Secrets } from './obsidian/secrets';
import { newId, SettingsStore } from './obsidian/settings-store';
import { VaultTagIndex } from './obsidian/tag-index';
import { RunController, type LmStudioControl } from './run/run-controller';
import { TemplateCommands } from './ui/commands';
import { DeriveModal, type DeriveOptions } from './ui/derive-modal';
import { InferenceMachineSettingTab } from './ui/settings-tab';
import { ExportModal, ImportModal } from './ui/template-transfer';

/** The settings API Obsidian uses internally to open a plugin's tab; it isn't in the public typings. */
interface AppSettings {
	setting?: { open(): void; openTabById(id: string): void };
}

/** Obsidian's own submenus, which its plugin typings leave out (Q65). */
interface SubmenuItem {
	setSubmenu(): Menu;
}

/** Whether this Obsidian gives menu items submenus. If a later version drops it, the templates go in the menu itself. */
function hasSubmenus(): boolean {
	return typeof (MenuItem.prototype as Partial<SubmenuItem>).setSubmenu === 'function';
}

/**
 * The note and text for a selection run, or undefined when there's nothing
 * to run on: no selection, only whitespace, or an editor that isn't a
 * Markdown note's, such as a canvas card (Q55).
 */
function selectionSource(editor: Editor, info: MarkdownFileInfo): { path: string; text: string } | undefined {
	const text = editor.getSelection();
	const file = info.file;
	if (text.trim() === '' || !file || file.extension !== 'md') return undefined;
	return { path: file.path, text };
}

/**
 * Inference Machine: derives a new note from an existing one by sending it,
 * through a template, to a configured AI engine.
 *
 * This class owns the plugin lifecycle and wires the layers together:
 * settings, secrets, engines, the vault tag index and the run controller.
 */
export default class InferenceMachinePlugin extends Plugin {
	/** The plugin's settings, loaded from `data.json`. */
	store!: SettingsStore;
	secrets!: Secrets;
	tagIndex!: VaultTagIndex;
	controller!: RunController;

	/** Loads settings, then registers the plugin's entry points. */
	override async onload(): Promise<void> {
		this.store = new SettingsStore(this);
		const warnings = await this.store.load();
		for (const warning of warnings) new Notice(`Inference Machine: ${warning}`);

		this.secrets = new Secrets(this.app);
		this.tagIndex = new VaultTagIndex(this.app);
		this.tagIndex.attach((ref) => this.registerEvent(ref));
		this.controller = new RunController({
			app: this.app,
			store: this.store,
			engineFor: (config) => this.engineFor(config),
			tagIndex: this.tagIndex,
			yaml: { parse: (text) => parseYaml(text) as unknown, stringify: stringifyYaml },
			lmStudio: this.lmStudioControl(),
		});

		// Entry points (REQ-1). Opening the popup reads only local state (1.0.5).
		this.addRibbonIcon('sparkles', 'Open Inference Machine', () => this.openDerive());
		// Obsidian shows this as "Inference Machine: Open".
		this.addCommand({ id: 'open', name: 'Open', callback: () => this.openDerive() });
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => this.addSelectionItems(menu, editor, info)));
		// "Inference Machine: Derive from selection", offered only while text is selected, so it can have a hotkey (Q55).
		this.addCommand({
			id: 'derive-selection',
			name: 'Derive from selection',
			editorCheckCallback: (checking, editor, info) => {
				const selection = selectionSource(editor, info);
				if (!selection) return false;
				if (!checking) this.openDerive({ selection });
				return true;
			},
		});
		const templateCommands = new TemplateCommands(this, (templateId) => this.openDerive({ templateId }));
		templateCommands.sync(this.store.data.templates);
		this.register(this.store.onChange((data) => templateCommands.sync(data.templates)));

		this.addSettingTab(
			new InferenceMachineSettingTab({
				app: this.app,
				plugin: this,
				store: this.store,
				http: obsidianHttp,
				engineFor: (config) => this.engineFor(config),
				newId,
				lmStudio: this.lmStudioControl(),
				renderTemplateTransfer: (container, refresh) => {
					new ButtonComponent(container).setButtonText('Import').onClick(() => new ImportModal(this.app, this.store, newId, refresh).open());
					new ButtonComponent(container).setButtonText('Export').onClick(() => new ExportModal(this.app, this.store).open());
				},
			}),
		);
	}

	/** Cancels any run in flight; everything registered through the Plugin API is cleaned up by Obsidian. */
	override onunload(): void {
		this.controller?.cancel();
		resetStreamingBlocked();
	}

	/** The client for a saved engine, reading its key from SecretStorage at request time. */
	engineFor(config: EngineConfig): Engine {
		return createEngine(config, { http: obsidianHttp, getSecret: (id) => this.secrets.get(id) });
	}

	/** LM Studio's native API, authenticated with the engine's own token when it has one (4.0.9, 4.0.10). */
	lmStudioControl(): LmStudioControl {
		const token = (engine: EngineConfig) => (engine.secretId ? this.secrets.get(engine.secretId) : undefined);
		return {
			read: (engine) => readLoadedModel(obsidianHttp, engine, token(engine)),
			load: (engine, contextLength, current) => loadWithContextLength(obsidianHttp, engine, contextLength, current, token(engine)),
		};
	}

	/** Opens the Inference Machine popup (1.0.1, 1.0.2), optionally with a template preselected (1.0.3). */
	openDerive(options: DeriveOptions = {}): void {
		new DeriveModal(
			{ app: this.app, store: this.store, controller: this.controller, openSettings: () => this.openSettings() },
			options,
		).open();
	}

	/**
	 * Adds the right-click items for selected text (Q55): "Derive from
	 * selection", which opens the popup in selection mode, and "Derive
	 * selection with", whose templates run straight away.
	 */
	private addSelectionItems(menu: Menu, editor: Editor, info: MarkdownFileInfo): void {
		const selection = selectionSource(editor, info);
		if (!selection) return;
		const section = 'inference-machine';
		menu.addItem((item) =>
			item
				.setTitle('Derive from selection')
				.setIcon('sparkles')
				.setSection(section)
				.onClick(() => this.openDerive({ selection })),
		);
		const templates = this.store.data.templates;
		if (templates.length === 0) return;
		const run = (templateId: string) => this.openDerive({ templateId, selection, runNow: true });
		if (hasSubmenus()) {
			menu.addItem((item) => {
				item.setTitle('Derive selection with').setIcon('sparkles').setSection(section);
				const submenu = (item as MenuItem & SubmenuItem).setSubmenu();
				for (const template of templates) submenu.addItem((sub) => sub.setTitle(template.name).onClick(() => run(template.id)));
			});
			return;
		}
		for (const template of templates) {
			menu.addItem((item) =>
				item
					.setTitle(`Derive selection with ${template.name}`)
					.setIcon('sparkles')
					.setSection(section)
					.onClick(() => run(template.id)),
			);
		}
	}

	/** Opens this plugin's settings tab. */
	openSettings(): void {
		const setting = (this.app as unknown as AppSettings).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}
}
