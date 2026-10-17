import type { Command } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { defaultPluginData } from '../../src/core/defaults';
import type { Template } from '../../src/core/schema';
import { SettingsStore } from '../../src/obsidian/settings-store';
import { TemplateCommands, templateCommandId } from '../../src/ui/commands';

/** Records commands the way Obsidian's command registry holds them. */
class Registry {
	readonly commands = new Map<string, Command>();
	readonly log: string[] = [];
	addCommand(command: Command): Command {
		this.commands.set(command.id, command);
		this.log.push(`add ${command.id} ${command.name}`);
		return command;
	}
	removeCommand(id: string): void {
		this.commands.delete(id);
		this.log.push(`remove ${id}`);
	}
	names(): string[] {
		return [...this.commands.values()].map((c) => c.name);
	}
}

const t = (id: string, name: string): Template => ({ id, name, prompt: 'p' });

describe('TemplateCommands', () => {
	it('registers one "Derive with" command per template that opens it (1.3)', () => {
		const registry = new Registry();
		const open = vi.fn();
		new TemplateCommands(registry, open).sync([t('a', 'Action items'), t('s', 'Summary')]);
		expect(registry.names()).toEqual(['Derive with Action items', 'Derive with Summary']);
		registry.commands.get('derive-a')?.callback?.();
		expect(open).toHaveBeenCalledWith('a');
	});

	it('renames a renamed template\'s command, keeping its id, and removes a deleted one\'s (1.4)', () => {
		const registry = new Registry();
		const commands = new TemplateCommands(registry, () => undefined);
		commands.sync([t('a', 'Action items'), t('s', 'Summary')]);
		registry.log.length = 0;
		commands.sync([t('a', 'Tasks')]);
		expect(registry.log).toEqual(['remove derive-a', 'remove derive-s', 'add derive-a Derive with Tasks']);
		expect(registry.names()).toEqual(['Derive with Tasks']);
	});

	it('leaves unchanged templates alone and adds new ones', () => {
		const registry = new Registry();
		const commands = new TemplateCommands(registry, () => undefined);
		commands.sync([t('a', 'A')]);
		registry.log.length = 0;
		commands.sync([t('a', 'A'), t('b', 'B')]);
		expect(registry.log).toEqual(['add derive-b Derive with B']);
		expect(templateCommandId('x')).toBe('derive-x');
	});

	it('re-syncs whenever the settings are saved', async () => {
		const data = defaultPluginData();
		data.templates = [t('a', 'A')];
		const store = new SettingsStore({ loadData: async () => structuredClone(data), saveData: async () => undefined });
		await store.load();
		const registry = new Registry();
		const commands = new TemplateCommands(registry, () => undefined);
		commands.sync(store.data.templates);
		const stop = store.onChange((d) => commands.sync(d.templates));
		await store.update((d) => {
			d.templates[0]!.name = 'Renamed';
		});
		expect(registry.names()).toEqual(['Derive with Renamed']);
		stop();
		await store.update((d) => d.templates.push(t('b', 'B')));
		expect(registry.names()).toEqual(['Derive with Renamed']);
	});
});
