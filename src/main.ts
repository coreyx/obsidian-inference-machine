import { Notice, Plugin } from 'obsidian';
import { SettingsStore } from './obsidian/settings-store';

/**
 * Inference Machine: derives a new note from an existing one by sending it,
 * through a template, to a configured AI engine.
 *
 * This class owns the plugin lifecycle. Entry points, settings and the derive
 * popup are registered here as they are built.
 */
export default class InferenceMachinePlugin extends Plugin {
	/** The plugin's settings, loaded from `data.json`. */
	store!: SettingsStore;

	/** Loads settings, then registers the plugin's entry points. */
	override async onload(): Promise<void> {
		this.store = new SettingsStore(this);
		const warnings = await this.store.load();
		for (const warning of warnings) new Notice(`Inference Machine: ${warning}`);
	}

	/** Nothing to release yet: everything registered through the Plugin API is cleaned up by Obsidian. */
	override onunload(): void {}
}
