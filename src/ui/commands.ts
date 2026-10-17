import type { Command } from 'obsidian';
import type { Template } from '../core/schema';

/** The part of Obsidian's `Plugin` that registers commands. */
export interface CommandHost {
	addCommand(command: Command): Command;
	removeCommand(id: string): void;
}

/** The command id for a template's "Derive with" command. Ids are stable, so renaming keeps hotkeys (1.4). */
export function templateCommandId(templateId: string): string {
	return `derive-${templateId}`;
}

/**
 * One "Derive with <template>" command per template (1.0.3), kept in step
 * with the template list (1.0.4): a new template gets a command, a deleted
 * one loses it, and a renamed one has its command re-registered under the
 * new name with the same id.
 */
export class TemplateCommands {
	/** Template id → the name its command was registered with. */
	private readonly registered = new Map<string, string>();

	constructor(
		private readonly host: CommandHost,
		private readonly open: (templateId: string) => void,
	) {}

	/** Updates the registered commands to match the templates. */
	sync(templates: readonly Template[]): void {
		const current = new Map(templates.map((t) => [t.id, t.name]));
		for (const [id, name] of this.registered) {
			if (current.get(id) === name) continue;
			this.host.removeCommand(templateCommandId(id));
			this.registered.delete(id);
		}
		for (const [id, name] of current) {
			if (this.registered.has(id)) continue;
			this.host.addCommand({ id: templateCommandId(id), name: `Derive with ${name}`, callback: () => this.open(id) });
			this.registered.set(id, name);
		}
	}
}
