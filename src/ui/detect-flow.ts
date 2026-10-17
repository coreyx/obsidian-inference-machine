import { Modal, Notice, SecretComponent, Setting, type App } from 'obsidian';
import type { EngineConfig } from '../core/schema';
import type { ModelInfo } from '../engines/engine';
import { detectLmStudio, detectMessage, upsertLmStudioEngine, type DetectResult } from '../engines/lmstudio';
import type { Http } from '../engines/transport';
import { Secrets } from '../obsidian/secrets';
import type { SettingsStore } from '../obsidian/settings-store';

/** What the detect flow needs from the plugin. */
export interface DetectHost {
	app: App;
	http: Http;
	store: SettingsStore;
}

/** How a detection attempt ended, for the settings tab to show. */
export interface DetectOutcome {
	engine?: EngineConfig;
	message: string;
}

/** Asks which model the engine should use, with the loaded one preselected (4.0.3, 4.2). */
class ModelChoiceModal extends Modal {
	private chosen: ModelInfo | undefined;

	constructor(
		app: App,
		private readonly models: ModelInfo[],
		private readonly preselected: string | undefined,
		private resolve: (model: ModelInfo | undefined) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Choose an LM Studio model');
		this.chosen = this.models.find((m) => m.id === this.preselected) ?? this.models[0];
		new Setting(this.contentEl)
			.setName('Model')
			.setDesc('Loaded models are marked. The engine loads another model on first use if LM Studio allows it.')
			.addDropdown((dropdown) => {
				for (const model of this.models) dropdown.addOption(model.id, `${model.name ?? model.id}${model.loaded ? ' (loaded)' : ''}`);
				dropdown.setValue(this.chosen?.id ?? '');
				dropdown.onChange((id) => {
					this.chosen = this.models.find((m) => m.id === id);
				});
			});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.finish(undefined)))
			.addButton((button) =>
				button
					.setButtonText('Use this model')
					.setCta()
					.onClick(() => this.finish(this.chosen)),
			);
	}

	private finish(model: ModelInfo | undefined): void {
		this.resolve(model);
		this.resolve = () => undefined;
		this.close();
	}

	override onClose(): void {
		this.resolve(undefined);
		this.contentEl.empty();
	}
}

/**
 * Asks for LM Studio's API token when its "Require authentication" setting
 * is on (4.0.7), and retries detection with it. A rejected token is reported
 * in the modal, naming where tokens are managed (4.0.8).
 */
class TokenModal extends Modal {
	private secretId: string | undefined;
	private typed = '';
	private status!: HTMLElement;

	constructor(
		app: App,
		private readonly port: number,
		private readonly attempt: (secretId: string) => Promise<DetectResult>,
		private resolve: (result: { secretId: string; result: DetectResult } | undefined) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('LM Studio needs an API token');
		this.status = this.contentEl.createEl('p', { text: detectMessage({ kind: 'auth-required', tokenRejected: false }, this.port) });
		new Setting(this.contentEl)
			.setName('Stored token')
			.setDesc('Pick a token you already stored in Obsidian.')
			.addComponent((el) =>
				new SecretComponent(this.app, el).onChange((id) => {
					this.secretId = id ?? undefined;
				}),
			);
		new Setting(this.contentEl)
			.setName('Or paste a new token')
			.setDesc('It is kept in Obsidian\'s secret storage, not in the plugin\'s settings.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text.onChange((value) => {
					this.typed = value.trim();
				});
			});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText('Connect')
					.setCta()
					.onClick(() => void this.connect(button.buttonEl)),
			);
	}

	private async connect(button: HTMLButtonElement): Promise<void> {
		let id = this.secretId;
		if (this.typed !== '') {
			id = `lm-studio-${this.port}`;
			new Secrets(this.app).set(id, this.typed);
		}
		if (!id) {
			this.status.setText('Pick a stored token or paste a new one.');
			return;
		}
		button.disabled = true;
		const result = await this.attempt(id);
		button.disabled = false;
		if (result.kind === 'auth-required') {
			this.status.setText(detectMessage({ kind: 'auth-required', tokenRejected: true }, this.port));
			return;
		}
		this.resolve({ secretId: id, result });
		this.resolve = () => undefined;
		this.close();
	}

	override onClose(): void {
		this.resolve(undefined);
		this.contentEl.empty();
	}
}

/**
 * The "Detect LM Studio" button (REQ-4): probe, ask for a token if needed,
 * let the user choose a model when there are several, then create or update
 * the LM Studio engine. The first engine a user creates becomes the default.
 */
export async function runLmStudioDetection(host: DetectHost, port: number): Promise<DetectOutcome> {
	const secrets = new Secrets(host.app);
	const existing = host.store.data.engines.find((e) => e.lmStudio?.port === port);
	const knownSecret = existing?.secretId;
	let secretId: string | undefined;

	let result = await detectLmStudio(host.http, port, knownSecret ? secrets.get(knownSecret) : undefined);
	if (result.kind === 'ok' && knownSecret) secretId = knownSecret;
	if (result.kind === 'auth-required') {
		const answer = await new Promise<{ secretId: string; result: DetectResult } | undefined>((resolve) => {
			new TokenModal(host.app, port, (id) => detectLmStudio(host.http, port, secrets.get(id)), resolve).open();
		});
		if (!answer) return { message: 'LM Studio detection was cancelled.' };
		secretId = answer.secretId;
		result = answer.result;
	}
	if (result.kind !== 'ok') return { message: detectMessage(result, port) };

	const okResult = result;
	const model =
		okResult.models.length === 1
			? okResult.models[0]
			: await new Promise<ModelInfo | undefined>((resolve) => {
					new ModelChoiceModal(host.app, okResult.models, okResult.loadedModelId, resolve).open();
				});
	if (!model) return { message: 'LM Studio detection was cancelled.' };

	const { engines, engine, created } = upsertLmStudioEngine(host.store.data.engines, {
		port,
		baseUrl: okResult.baseUrl,
		model,
		newId: crypto.randomUUID(),
		...(secretId !== undefined ? { secretId } : {}),
	});
	await host.store.update((data) => {
		data.engines = engines;
		data.defaultEngineId ??= engine.id;
	});
	const message = `${created ? 'Created' : 'Updated'} the "${engine.name}" engine using ${model.name ?? model.id}.`;
	new Notice(message);
	return { engine, message };
}
