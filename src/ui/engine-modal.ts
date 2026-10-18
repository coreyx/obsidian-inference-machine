import { ButtonComponent, DropdownComponent, Modal, SecretComponent, Setting, type App, type TextComponent } from 'obsidian';
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
 *
 * Only a provider change rebuilds the form, because the fields differ by
 * provider. Everything else updates in place, so the form never jumps or
 * loses what's been typed.
 */
export class EngineModal extends Modal {
	private draft: EngineConfig;
	private models: ModelInfo[] = [];
	private statusEl!: HTMLElement;
	private missingEl!: HTMLElement;
	private testButton!: ButtonComponent;
	private saveButton!: ButtonComponent;
	private modelInput!: TextComponent;
	private modelSetting!: Setting;
	private modelDropdown: DropdownComponent | undefined;
	private contextInput!: TextComponent;
	private contextSetting!: Setting;

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

	private get compatible(): boolean {
		return this.draft.provider === 'openai-compatible';
	}

	/** The name the engine gets when the Name field is left empty. */
	private defaultName(): string {
		return PROVIDER_LABELS[this.draft.provider];
	}

	/** Builds the form for the current provider. */
	private render(): void {
		const el = this.contentEl;
		const scroll = { modal: this.modalEl.scrollTop, content: el.scrollTop };
		el.empty();
		this.setTitle(this.existing ? `Edit "${this.existing.name}"` : 'Add an engine');
		const draft = this.draft;

		new Setting(el).setName('Provider').addDropdown((d) => {
			for (const [value, label] of Object.entries(PROVIDER_LABELS)) d.addOption(value, label);
			d.setValue(draft.provider).onChange((value) => this.changeProvider(value as ProviderType));
		});

		new Setting(el)
			.setName('Name')
			.setDesc(`Shown in the popup's engine list. Leave empty to use "${this.defaultName()}".`)
			.addText((t) =>
				t
					.setPlaceholder(this.defaultName())
					.setValue(draft.name)
					.onChange((v) => {
						draft.name = v;
						this.refreshState();
					}),
			);

		new Setting(el)
			.setName('Base URL')
			.setDesc(
				this.compatible
					? 'Required. The server\'s OpenAI-compatible address, usually ending in /v1.'
					: 'Optional. Leave empty to use the provider\'s standard address.',
			)
			.addText((t) =>
				t
					.setPlaceholder(BASE_URL_HINTS[draft.provider])
					.setValue(draft.baseUrl ?? '')
					.onChange((v) => {
						if (v.trim() === '') delete draft.baseUrl;
						else draft.baseUrl = v.trim();
						this.refreshState();
					}),
			);

		new Setting(el)
			.setName('API key')
			.setDesc(
				this.compatible
					? 'Optional. Sent as a Bearer token only when set, such as an LM Studio API token. Kept in Obsidian\'s secret storage, not in this plugin\'s settings.'
					: 'Required. Kept in Obsidian\'s secret storage, not in this plugin\'s settings. Secrets stay on this device, so add the key again on each device.',
			)
			.addComponent((container) => {
				const secret = new SecretComponent(this.app, container);
				if (draft.secretId) secret.setValue(draft.secretId);
				secret.onChange((id) => {
					if (id) draft.secretId = id;
					else delete draft.secretId;
					this.refreshState();
				});
				return secret;
			});

		this.modelSetting = new Setting(el)
			.setName('Model')
			.setDesc('Required. Type a model ID, or list the provider\'s models and choose one.')
			.addText((t) => {
				this.modelInput = t;
				t.setPlaceholder('Model ID')
					.setValue(draft.model)
					.onChange((v) => {
						draft.model = v.trim();
						this.modelDropdown?.setValue(this.models.some((m) => m.id === draft.model) ? draft.model : '');
						this.refreshState();
					});
			})
			.addButton((b) => b.setButtonText('List models').onClick(() => void this.listModels(b)));
		this.modelDropdown = undefined;

		this.numberSetting(el, 'Temperature', 'Optional. Leave empty for the model\'s default.', draft.temperature, (v) => {
			if (v === undefined) delete draft.temperature;
			else draft.temperature = v;
		});
		this.numberSetting(el, 'Maximum output tokens', "Optional. The longest reply the model may write. Leave empty for the provider's or model's own limit; Anthropic requires one, so it gets 8,192.", draft.maxOutputTokens, (v) => {
			if (v === undefined) delete draft.maxOutputTokens;
			else draft.maxOutputTokens = Math.round(v);
		});
		[this.contextSetting, this.contextInput] = this.numberSetting(el, 'Context window', '', draft.contextWindow, (v) => {
			if (v === undefined) {
				delete draft.contextWindow;
				delete draft.contextWindowSource;
			} else {
				draft.contextWindow = Math.round(v);
				draft.contextWindowSource = 'user';
			}
			this.refreshContextDesc();
		});
		this.refreshContextDesc();

		new Setting(el)
			.setName('Test')
			.setDesc('Sends a tiny request to check the engine works.')
			.addButton((b) => {
				this.testButton = b;
				b.setButtonText('Test').onClick(() => void this.test());
			});
		this.statusEl = el.createDiv({ cls: 'im-status-line', attr: { role: 'status', 'aria-live': 'polite' } });
		this.missingEl = el.createDiv({ cls: 'setting-item-description im-missing' });

		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => {
				this.saveButton = b;
				b.setButtonText('Save')
					.setCta()
					.onClick(() => void this.save());
			});

		this.refreshState();
		this.modalEl.scrollTop = scroll.modal;
		el.scrollTop = scroll.content;
	}

	/** An optional number field. Returns the setting and its text box, for updating them in place. */
	private numberSetting(el: HTMLElement, name: string, desc: string, value: number | undefined, set: (v: number | undefined) => void): [Setting, TextComponent] {
		let input!: TextComponent;
		const setting = new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				input = t;
				t.inputEl.type = 'number';
				t.setValue(value === undefined ? '' : String(value)).onChange((text) => {
					const parsed = optionalNumber(text);
					if (parsed !== 'invalid') set(parsed);
				});
			});
		return [setting, input];
	}

	/** Switching providers starts the form over: the old provider's values don't carry over. */
	private changeProvider(provider: ProviderType): void {
		const lmStudio = this.draft.lmStudio;
		this.draft = { id: this.draft.id, name: '', provider, model: '' };
		// A detected LM Studio engine keeps its link to the port only while it stays OpenAI-compatible.
		if (lmStudio && provider === 'openai-compatible') this.draft.lmStudio = lmStudio;
		this.models = [];
		this.render();
	}

	private refreshContextDesc(): void {
		const draft = this.draft;
		this.contextSetting.setDesc(
			draft.contextWindow === undefined
				? 'Unknown, so Inference Machine can\'t warn before sending a note that\'s too long for this engine. Enter the model\'s context window in tokens to get that warning.'
				: `In tokens. Used to warn before sending a note that's too long.${draft.contextWindowSource === 'reported' ? ' Reported by the provider.' : draft.contextWindowSource === 'table' ? ' From Inference Machine\'s list of known models.' : ''}`,
		);
	}

	/** What's missing before the engine can be tested, or saved. */
	private missing(): string[] {
		const draft = this.draft;
		const missing: string[] = [];
		if (this.compatible && !draft.baseUrl) missing.push('a base URL');
		if (!this.compatible && !(draft.secretId && this.app.secretStorage.getSecret(draft.secretId))) missing.push('an API key');
		if (draft.model === '') missing.push('a model');
		return missing;
	}

	/** The name problem that blocks saving: engine names must be unique, so the popup and imports can tell engines apart. */
	private nameProblem(): string | undefined {
		const name = this.draft.name.trim() || this.defaultName();
		const taken = this.ctx.store.data.engines.some((e) => e.id !== this.draft.id && e.name.toLowerCase() === name.toLowerCase());
		return taken ? `An engine named "${name}" already exists. Give this one a different name.` : undefined;
	}

	/** Enables Test and Save only when the required fields are filled, and says what's missing. */
	private refreshState(): void {
		const missing = this.missing();
		const nameProblem = this.nameProblem();
		this.testButton.setDisabled(missing.length > 0);
		this.saveButton.setDisabled(missing.length > 0 || nameProblem !== undefined);
		const lines: string[] = [];
		if (missing.length > 0) lines.push(`To test or save, add ${missing.join(' and ')}.`);
		if (nameProblem) lines.push(nameProblem);
		this.missingEl.setText(lines.join(' '));
	}

	private setStatus(text: string): void {
		this.statusEl.setText(text);
	}

	private async listModels(button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		this.setStatus('Listing models…');
		try {
			this.models = await this.ctx.engineFor(this.draft).listModels();
			this.setStatus(this.models.length === 0 ? 'The provider listed no models. Type a model ID instead.' : `Found ${this.models.length} models.`);
			this.showModelChoices();
		} catch (error) {
			this.setStatus(error instanceof Error ? error.message : String(error));
		}
		button.setDisabled(false);
	}

	/** Adds the listed models as a dropdown next to the Model field, or refreshes it. */
	private showModelChoices(): void {
		if (this.models.length === 0) return;
		if (!this.modelDropdown) {
			this.modelSetting.addDropdown((d) => {
				this.modelDropdown = d;
				d.onChange((id) => this.chooseModel(id));
			});
		}
		const d = this.modelDropdown!;
		d.selectEl.empty();
		d.addOption('', 'Choose a model');
		for (const m of this.models) d.addOption(m.id, m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id);
		d.setValue(this.models.some((m) => m.id === this.draft.model) ? this.draft.model : '');
	}

	private chooseModel(id: string): void {
		const model = this.models.find((m) => m.id === id);
		if (!model) return;
		this.draft.model = model.id;
		this.modelInput.setValue(model.id);
		// 3.0.9: a context window the provider reports fills the setting.
		if (model.contextWindow !== undefined) {
			this.draft.contextWindow = model.contextWindow;
			this.draft.contextWindowSource = 'reported';
			this.contextInput.setValue(String(model.contextWindow));
			this.refreshContextDesc();
		}
		this.refreshState();
	}

	private async test(): Promise<void> {
		if (this.missing().length > 0) return;
		this.testButton.setDisabled(true);
		this.setStatus('Testing…');
		try {
			await this.ctx.engineFor(this.draft).test();
			this.setStatus(`Connected. ${this.draft.name.trim() || this.defaultName()} answered with ${this.draft.model}.`);
		} catch (error) {
			// 3.0.5, 3.4: the provider's error in plain language, never a stack trace.
			this.setStatus(`Test failed. ${error instanceof Error ? error.message : String(error)}`);
		}
		this.refreshState();
	}

	private async save(): Promise<void> {
		if (this.missing().length > 0 || this.nameProblem()) {
			this.refreshState();
			return;
		}
		const draft = this.draft;
		// An empty name means the name shown in grey, the way an empty Base URL means the standard address.
		draft.name = draft.name.trim() || this.defaultName();
		// 3.0.9: providers that don't report a context window fall back to the known-model table.
		if (draft.contextWindow === undefined && !this.compatible) {
			const known = knownContextWindow(draft.model);
			if (known !== undefined) {
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

