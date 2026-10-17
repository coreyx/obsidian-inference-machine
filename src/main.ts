import { Notice, parseYaml, Plugin, stringifyYaml } from 'obsidian';
import type { EngineConfig } from './core/schema';
import { createEngine } from './engines/factory';
import type { Engine } from './engines/engine';
import { obsidianHttp, resetStreamingBlocked } from './engines/transport';
import { Secrets } from './obsidian/secrets';
import { newId, SettingsStore } from './obsidian/settings-store';
import { VaultTagIndex } from './obsidian/tag-index';
import { RunController } from './run/run-controller';
import { TemplateCommands } from './ui/commands';
import { DeriveModal, type DeriveOptions } from './ui/derive-modal';
import { InferenceMachineSettingTab } from './ui/settings-tab';

/** The settings API Obsidian uses internally to open a plugin's tab; it isn't in the public typings. */
interface AppSettings {
	setting?: { open(): void; openTabById(id: string): void };
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
		});

		// Entry points (REQ-1). Opening the popup reads only local state (1.0.5).
		this.addRibbonIcon('sparkles', 'Open Inference Machine', () => this.openDerive());
		// Obsidian shows this as "Inference Machine: Open".
		this.addCommand({ id: 'open', name: 'Open', callback: () => this.openDerive() });
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

	/** Opens the Inference Machine popup (1.0.1, 1.0.2), optionally with a template preselected (1.0.3). */
	openDerive(options: DeriveOptions = {}): void {
		new DeriveModal(
			{ app: this.app, store: this.store, controller: this.controller, openSettings: () => this.openSettings() },
			options,
		).open();
	}

	/** Opens this plugin's settings tab. */
	openSettings(): void {
		const setting = (this.app as unknown as AppSettings).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}
}
