import type { App } from 'obsidian';

/**
 * API keys live in Obsidian's SecretStorage, never in `data.json` (18.0.4).
 * Plugin settings hold only a secret's id; the value is read when a request
 * is made. SecretStorage ids are lowercase letters, digits and dashes.
 */
export class Secrets {
	constructor(private readonly app: App) {}

	/** The secret's value, or undefined when there's no secret with that id. */
	get(id: string): string | undefined {
		return this.app.secretStorage.getSecret(id) ?? undefined;
	}

	/** Stores a secret, replacing any value already stored under the id. */
	set(id: string, value: string): void {
		this.app.secretStorage.setSecret(id, value);
	}

	/** The ids of every stored secret, including ones other plugins stored. */
	list(): string[] {
		return this.app.secretStorage.listSecrets();
	}
}

/** Turns any text into a valid SecretStorage id: lowercase letters, digits and single dashes. */
export function secretIdFrom(text: string): string {
	const id = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return id === '' ? 'inference-machine-key' : id;
}
