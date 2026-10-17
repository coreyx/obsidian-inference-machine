import { Plugin } from 'obsidian';

/**
 * Inference Machine: derives a new note from an existing one by sending it,
 * through a template, to a configured AI engine.
 *
 * This class owns the plugin lifecycle. Entry points, settings and the derive
 * popup are registered here as they are built.
 */
export default class InferenceMachinePlugin extends Plugin {
	/** Registers the plugin's entry points and loads its settings. */
	override async onload(): Promise<void> {}

	/** Nothing to release yet: everything registered through the Plugin API is cleaned up by Obsidian. */
	override onunload(): void {}
}
