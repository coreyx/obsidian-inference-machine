import { Modal, SecretComponent, Setting, type App } from 'obsidian';
import type { EngineConfig, ProviderType } from '../core/schema';
import type { Engine, ModelInfo } from '../engines/engine';
import { knownContextWindow } from '../engines/model-metadata';
import { resetStreamingBlocked } from '../engines/transport';
import type { SettingsStore } from '../obsidian/settings-store';

/** What the engine form needs from the plugin. */
export interface EngineFormContext {
	app: App;
	store: SettingsStore;
	engineFor: (config: EngineConfig) => Engine;
	newId: () => string;
}

/** Display names for the provider types. */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	gemini: 'Google Gemini',
	'openai-compatible': 'OpenAI-compatible',
};

const BASE_URL_HINTS: Record<ProviderType, string> = {
	anthropic: 'https://api.anthropic.com',
	openai: 'https://api.openai.com/v1',
	gemini: 'https://generativelanguage.googleapis.com/v1beta',
	'openai-compatible': 'http://localhost:1234/v1',
};

/** Parses an optional number field: empty means "not set". */
function optionalNumber(text: string): number | undefined | 'invalid' {
	const trimmed = text.trim();
	if (trimmed === '') return undefined;
	const n = Number(trimmed);
	return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

/**
 * Adds or edits an engine (3.0.2): provider, name, base URL, API key (from
 * SecretStorage), model with "List models" (3.0.4), generation settings and
 * the context window (3.0.9), plus "Test" (3.0.5).
 */
export class EngineModal extends Modal {
	private draft: EngineConfig;
	private models: ModelInfo[] = [];
	private status = '';
	private error = '';

	constructor(
		private readonly ctx: EngineFormContext,
		private readonly existing: EngineConfig | undefined,
		private readonly onSaved: () => void,
	) {
		super(ctx.app);
		this.draft = existing ? structuredClone(existing) : { id: ctx.newId(), name: '', provider: 'anthropic', model: '' };
	}

	override onOpen(): void {
		this.modalEl.addClass('inference-machine-settings-modal');
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		this.setTitle(this.existing ? `Edit "${this.existing.name}"` : 'Add an engine');
		const draft = this.draft;

		new Setting(el).setName('Provider').addDropdown((d) => {
			for (const [value, label] of Object.entries(PROVIDER_LABELS)) d.addOption(value, label);
			d.setValue(draft.provider).onChange((value) => {
				draft.provider = value as ProviderType;
				this.models = [];
				this.render();
			});
		});

		new Setting(el).setName('Name').setDesc('Shown in the popup\'s engine list.').addText((t) =>
			t
				.setPlaceholder(PROVIDER_LABELS[draft.provider])
				.setValue(draft.name)
				.onChange((v) => (draft.name = v)),
		);

		const compatible = draft.provider === 'openai-compatible';
		new Setting(el)
			.setName('Base URL')
			.setDesc(compatible ? 'Required. The server\'s OpenAI-compatible address, usually ending in /v1.' : 'Optional. Leave empty to use the provider\'s standard address.')
			.addText((t) =>
				t
					.setPlaceholder(BASE_URL_HINTS[draft.provider])
					.setValue(draft.baseUrl ?? '')
					.onChange((v) => {
						if (v.trim() === '') delete draft.baseUrl;
						else draft.baseUrl = v.trim();
					}),
			);

		new Setting(el)
			.setName('API key')
			.setDesc(
				compatible
					? 'Optional. Sent as a Bearer token only when set, such as an LM Studio API token. Kept in Obsidian\'s secret storage, not in this plugin\'s settings.'
					: 'Kept in Obsidian\'s secret storage, not in this plugin\'s settings. Secrets stay on this device, so add the key again on each device.',
			)
			.addComponent((container) => {
				const secret = new SecretComponent(this.app, container);
				if (draft.secretId) secret.setValue(draft.secretId);
				secret.onChange((id) => {
					if (id) draft.secretId = id;
					else delete draft.secretId;
				});
				return secret;
			});

		const modelSetting = new Setting(el)
			.setName('Model')
			.setDesc('A model ID. List the provider\'s models, or type one.')
			.addText((t) =>
				t
					.setPlaceholder(draft.provider === 'anthropic' ? 'claude-sonnet-5-5' : 'Model ID')
					.setValue(draft.model)
					.onChange((v) => (draft.model = v.trim())),
			)
			.addButton((b) => b.setButtonText('List models').onClick(() => void this.listModels()));
		if (this.models.length > 0) {
			modelSetting.addDropdown((d) => {
				d.addOption('', 'Choose a model');
				for (const m of this.models) d.addOption(m.id, m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id);
				d.setValue(this.models.some((m) => m.id === draft.model) ? draft.model : '');
				d.onChange((id) => {
					const model = this.models.find((m) => m.id === id);
					if (!model) return;
					draft.model = model.id;
					// 3.0.9: a context window the provider reports fills the setting.
					if (model.contextWindow !== undefined) {
						draft.contextWindow = model.contextWindow;
						draft.contextWindowSource = 'reported';
					}
					this.render();
				});
			});
		}

		this.numberSetting(el, 'Temperature', 'Optional. Leave empty for the model\'s default.', draft.temperature, (v) => {
			if (v === undefined) delete draft.temperature;
			else draft.temperature = v;
		});
		this.numberSetting(el, 'Maximum output tokens', 'Optional. The longest reply the model may write. Defaults to 8,192.', draft.maxOutputTokens, (v) => {
			if (v === undefined) delete draft.maxOutputTokens;
			else draft.maxOutputTokens = Math.round(v);
		});
		this.numberSetting(
			el,
			'Context window',
			draft.contextWindow === undefined
				? 'Unknown, so Inference Machine can\'t warn before sending a note that\'s too long for this engine. Enter the model\'s context window in tokens to get that warning.'
				: `In tokens. Used to warn before sending a note that's too long.${draft.contextWindowSource === 'reported' ? ' Reported by the provider.' : draft.contextWindowSource === 'table' ? ' From Inference Machine\'s list of known models.' : ''}`,
			draft.contextWindow,
			(v) => {
				if (v === undefined) {
					delete draft.contextWindow;
					delete draft.contextWindowSource;
				} else {
					draft.contextWindow = Math.round(v);
					draft.contextWindowSource = 'user';
				}
			},
		);

		const test = new Setting(el).setName('Test').setDesc(this.status || 'Sends a tiny request to check the engine works.');
		test.addButton((b) => b.setButtonText('Test').onClick(() => void this.test()));

		if (this.error) el.createDiv({ cls: 'im-error', text: this.error, attr: { role: 'alert' } });

		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText('Save')
					.setCta()
					.onClick(() => void this.save()),
			);
	}

	private numberSetting(el: HTMLElement, name: string, desc: string, value: number | undefined, set: (v: number | undefined) => void): void {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(value === undefined ? '' : String(value)).onChange((text) => {
					const parsed = optionalNumber(text);
					if (parsed !== 'invalid') set(parsed);
				});
			});
	}

	private problems(): string | undefined {
		if (this.draft.name.trim() === '') return 'Give the engine a name.';
		if (this.draft.model === '') return 'Choose or type a model.';
		if (this.draft.provider === 'openai-compatible' && !this.draft.baseUrl) return 'An OpenAI-compatible engine needs a base URL.';
		return undefined;
	}

	private async listModels(): Promise<void> {
		this.status = 'Listing models…';
		this.render();
		try {
			this.models = await this.ctx.engineFor(this.draft).listModels();
			this.status = this.models.length === 0 ? 'The provider listed no models. Type a model ID instead.' : `Found ${this.models.length} models.`;
		} catch (error) {
			this.status = error instanceof Error ? error.message : String(error);
		}
		this.render();
	}

	private async test(): Promise<void> {
		this.status = 'Testing…';
		this.render();
		try {
			await this.ctx.engineFor(this.draft).test();
			this.status = `Connected. ${this.draft.name || 'The engine'} answered with ${this.draft.model}.`;
		} catch (error) {
			// 3.0.5, 3.4: the provider's error in plain language, never a stack trace.
			this.status = `Test failed. ${error instanceof Error ? error.message : String(error)}`;
		}
		this.render();
	}

	private async save(): Promise<void> {
		const problem = this.problems();
		if (problem) {
			this.error = problem;
			this.render();
			return;
		}
		const draft = this.draft;
		// 3.0.9: providers that don't report a context window fall back to the known-model table.
		if (draft.contextWindow === undefined) {
			const known = knownContextWindow(draft.model);
			if (known !== undefined && draft.provider !== 'openai-compatible') {
				draft.contextWindow = known;
				draft.contextWindowSource = 'table';
			}
		}
		await this.ctx.store.update((data) => {
			const index = data.engines.findIndex((e) => e.id === draft.id);
			if (index === -1) data.engines.push(draft);
			else data.engines[index] = draft;
			// The first engine becomes the default (3.0.3).
			data.defaultEngineId ??= draft.id;
		});
		// A changed engine, such as one whose server now allows CORS, gets to try streaming again.
		resetStreamingBlocked(draft.id);
		this.onSaved();
		this.close();
	}
}
