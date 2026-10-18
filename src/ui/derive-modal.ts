import { Modal, Notice, Platform, Setting, type App, type TFile } from 'obsidian';
import { resolveRunConfig, type PopupOverrides } from '../core/resolve';
import type { EngineConfig, OutputLocation, Template } from '../core/schema';
import { matchTemplate } from '../core/triggers';
import { isLocalEngine } from '../engines/factory';
import { readNote } from '../obsidian/note-reader';
import type { SettingsStore } from '../obsidian/settings-store';
import type { RequestName, RunController, RunPreview } from '../run/run-controller';
import { askCollision, confirmLongNote } from './confirm-modals';
import { createMarkdownEditor, type MarkdownEditor } from './preview-editor';
import { FolderSuggest, NoteSuggestModal } from './suggesters';

/** What the popup needs from the plugin. */
export interface DeriveContext {
	app: App;
	store: SettingsStore;
	controller: RunController;
	/** Opens the plugin's settings tab, for the "configure an engine" panel (3.0.8). */
	openSettings: () => void;
}

/** How the popup was opened. */
export interface DeriveOptions {
	/** Set by a "Derive with …" command, which preselects its template (1.0.3). */
	templateId?: string;
}

const PROVIDER_NAMES: Record<EngineConfig['provider'], string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	gemini: 'Google Gemini',
	'openai-compatible': 'an OpenAI-compatible server',
};

const REQUEST_LABELS: Record<RequestName, string> = { main: 'Main output', inline: 'Inline prompts', tags: 'AI tags', model: 'LM Studio model' };
/** The model row reads as a sentence, since it appears only while LM Studio reloads the model (4.0.10). */
const MODEL_STATUS_TEXT = { pending: 'Loading the model in LM Studio…', done: 'Model loaded in LM Studio', failed: "LM Studio couldn't load the model", skipped: '' } as const;
const STATUS_LABELS = { pending: 'Running…', done: 'Done', failed: 'Failed', skipped: 'Not needed' } as const;

/**
 * The Inference Machine popup (REQ-8, REQ-9): one modal with three steps.
 *
 * - Setup: source note, template, output location and engine, prefilled by
 *   settings resolution and changeable for this run only (8.0.1). Opening it
 *   reads only local state, never the network (1.0.5).
 * - Running: the main output streams into a read-only view (8.0.3), with a
 *   status per request and Cancel.
 * - Preview: an editor holding the exact text that will be saved (9.1), with
 *   the run's warnings, and Save, Discard and Back.
 *
 * Closing the popup at any point, Esc included, cancels a running request
 * and writes nothing (8.0.4, 9.0.3).
 */
export class DeriveModal extends Modal {
	private source: TFile | null = null;
	private templateId: string | undefined;
	/** The template to fall back on when no trigger matches: the last used, else the first (22.0.3). */
	private fallbackTemplateId: string | undefined;
	/** True once a command or the user chose the template, so triggers no longer change it (22.0.5). */
	private templatePicked = false;
	/** The trigger that chose the current template, shown under the dropdown (22.0.4). */
	private matchedTrigger: string | undefined;
	/** Guards against an older trigger check finishing after a newer one. */
	private matchToken = 0;
	private engineOverride: string | undefined;
	private locationOverride: OutputLocation | undefined;
	private error: string[] = [];
	private step: 'setup' | 'running' | 'preview' = 'setup';
	private editors: MarkdownEditor[] = [];
	private preview: RunPreview | undefined;
	private previewEditor: MarkdownEditor | undefined;
	private primaryAction: (() => void) | undefined;

	constructor(
		private readonly ctx: DeriveContext,
		private readonly options: DeriveOptions = {},
	) {
		super(ctx.app);
	}

	override onOpen(): void {
		this.modalEl.addClass('inference-machine-modal');
		if (Platform.isMobile) this.modalEl.addClass('im-mobile');
		this.prefill();
		// Mod+Enter runs from setup and saves from the preview (19.0.2).
		this.scope.register(['Mod'], 'Enter', (evt) => {
			evt.preventDefault();
			this.primaryAction?.();
			return false;
		});
		this.renderSetup();
	}

	override onClose(): void {
		this.ctx.controller.cancel();
		this.destroyEditors();
		this.contentEl.empty();
	}

	/** Fills the setup step from the active note and remembered choices (2.0.1, 19.0.3). */
	private prefill(): void {
		const active = this.app.workspace.getActiveFile();
		// 2.0.3: a PDF, canvas or other non-Markdown file leaves the source empty.
		this.source = active && active.extension === 'md' ? active : null;
		const { templates, ui } = this.ctx.store.data;
		const known = (id: string | undefined) => (id !== undefined && templates.some((t) => t.id === id) ? id : undefined);
		this.fallbackTemplateId = known(ui.lastTemplateId) ?? templates[0]?.id;
		const commanded = known(this.options.templateId);
		// 22.0.3: a template command beats triggers, which beat the last-used template.
		this.templatePicked = commanded !== undefined;
		this.templateId = commanded ?? this.fallbackTemplateId;
		// A template command chooses its own settings; otherwise the last location is remembered.
		if (this.options.templateId === undefined && ui.lastLocation) this.locationOverride = ui.lastLocation;
		void this.applyTriggers();
	}

	/**
	 * Preselects the first template whose trigger matches the source note
	 * (22.0.2), unless a command or the user already chose one. Reading the
	 * note is a local file read, so the popup still opens at once (1.0.5);
	 * the choice is applied when the read finishes.
	 */
	private async applyTriggers(): Promise<void> {
		const token = ++this.matchToken;
		const source = this.source;
		if (this.templatePicked) return;
		const match = source ? matchTemplate(this.ctx.store.data.templates, await readNote(this.app, source)) : undefined;
		if (token !== this.matchToken || this.templatePicked || this.step !== 'setup') return;
		const before = `${this.templateId}|${this.matchedTrigger}`;
		this.templateId = match ? match.template.id : this.fallbackTemplateId;
		this.matchedTrigger = match?.trigger;
		if (`${this.templateId}|${this.matchedTrigger}` !== before) this.renderSetup();
	}

	private get template(): Template | undefined {
		return this.ctx.store.data.templates.find((t) => t.id === this.templateId);
	}

	private popup(): PopupOverrides {
		return {
			...(this.engineOverride !== undefined ? { engineId: this.engineOverride } : {}),
			...(this.locationOverride !== undefined ? { location: this.locationOverride } : {}),
		};
	}

	private destroyEditors(): void {
		for (const editor of this.editors) editor.destroy();
		this.editors = [];
		this.previewEditor = undefined;
	}

	private reset(title: string, large: boolean): HTMLElement {
		this.destroyEditors();
		this.contentEl.empty();
		this.setTitle(title);
		this.modalEl.toggleClass('is-large', large);
		return this.contentEl;
	}

	// --- Setup -----------------------------------------------------------

	private renderSetup(): void {
		this.step = 'setup';
		this.primaryAction = undefined;
		const el = this.reset('Inference Machine', false);
		const data = this.ctx.store.data;

		if (data.engines.length === 0) {
			// 3.0.8: no engine, no Run button; point to where engines are set up.
			el.createEl('p', { text: 'Inference Machine needs an AI engine before it can derive notes.' });
			el.createEl('p', { text: 'Add one in the plugin\'s settings: an Anthropic, OpenAI or Gemini API key, a local LM Studio server, or any OpenAI-compatible endpoint.' });
			new Setting(el).addButton((b) =>
				b
					.setButtonText('Open engine settings')
					.setCta()
					.onClick(() => {
						this.close();
						this.ctx.openSettings();
					}),
			);
			return;
		}

		const template = this.template;
		const resolved = template
			? resolveRunConfig({
					popup: this.popup(),
					template,
					globalSettings: data.globalSettings,
					engines: data.engines,
					defaultEngineId: data.defaultEngineId,
				}).config
			: undefined;

		new Setting(el)
			.setName('Source note')
			.setDesc(this.source ? this.source.path : 'No note selected. Choose one to run.')
			.addButton((b) =>
				b.setButtonText(this.source ? 'Change' : 'Choose a note').onClick(() => {
					new NoteSuggestModal(this.app, (file) => {
						this.source = file;
						this.renderSetup();
						// 22.0.5: a new source note gets its own trigger match, unless the user chose a template.
						void this.applyTriggers();
					}).open();
				}),
			);

		new Setting(el)
			.setName('Template')
			.setDesc(this.matchedTrigger ? `Matched ${this.matchedTrigger}` : '')
			.addDropdown((dropdown) => {
				for (const t of data.templates) dropdown.addOption(t.id, t.name);
				if (this.templateId) dropdown.setValue(this.templateId);
				dropdown.onChange((id) => {
					this.templateId = id;
					this.templatePicked = true;
					this.matchedTrigger = undefined;
					this.renderSetup();
				});
			});

		const location = resolved?.location ?? { mode: 'alongside' };
		const locationSetting = new Setting(el).setName('Output location');
		locationSetting.addDropdown((dropdown) => {
			dropdown.addOption('alongside', 'Next to the source note').addOption('folder', 'In a folder');
			dropdown.setValue(location.mode);
			dropdown.onChange((mode) => {
				this.locationOverride = mode === 'folder' ? { mode: 'folder', path: location.mode === 'folder' ? location.path : '' } : { mode: 'alongside' };
				this.renderSetup();
			});
		});
		if (location.mode === 'folder') {
			locationSetting.addText((text) => {
				text.setPlaceholder('Folder').setValue(location.path);
				const set = (path: string) => (this.locationOverride = { mode: 'folder', path });
				text.onChange(set);
				new FolderSuggest(this.app, text.inputEl, set);
			});
		}

		const engine = resolved?.engine;
		new Setting(el)
			.setName('Engine')
			.setDesc(
				engine
					? isLocalEngine(engine)
						? 'Local: the note stays on this device or network.'
						: `Remote: the note is sent to ${PROVIDER_NAMES[engine.provider]}.`
					: '',
			)
			.addDropdown((dropdown) => {
				for (const e of data.engines) dropdown.addOption(e.id, `${e.name} (${isLocalEngine(e) ? 'local' : 'remote'})`);
				if (engine) dropdown.setValue(engine.id);
				dropdown.onChange((id) => {
					this.engineOverride = id;
					this.renderSetup();
				});
			});

		if (this.error.length > 0) {
			const box = el.createDiv({ cls: 'im-error', attr: { role: 'alert' } });
			for (const line of this.error) box.createEl('p', { text: line });
		}

		const canRun = this.source !== null && template !== undefined && engine !== undefined;
		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText('Run').setCta().setDisabled(!canRun).onClick(() => void this.run());
				if (canRun) window.setTimeout(() => b.buttonEl.focus(), 0);
			});
		this.primaryAction = canRun ? () => void this.run() : undefined;
	}

	// --- Running ---------------------------------------------------------

	private async run(): Promise<void> {
		const source = this.source;
		const template = this.template;
		if (!source || !template) return;
		this.error = [];
		this.step = 'running';
		this.primaryAction = undefined;
		const el = this.reset(`Running "${template.name}"`, true);

		const statusList = el.createEl('ul', { cls: 'im-status' });
		const rows = new Map<RequestName, HTMLElement>();
		for (const name of ['main', 'inline', 'tags'] as const) {
			const row = statusList.createEl('li', { text: `${REQUEST_LABELS[name]}: waiting` });
			rows.set(name, row);
		}
		const live = createMarkdownEditor(el.createDiv({ cls: 'im-editor' }), '', { readOnly: true, label: 'Output so far' });
		this.editors.push(live);
		new Setting(el).addButton((b) => b.setButtonText('Cancel').onClick(() => this.ctx.controller.cancel()));

		const outcome = await this.ctx.controller.start(
			{ sourcePath: source.path, templateId: template.id, popup: this.popup() },
			{
				onStatus: (name, status) => {
					if (name === 'model') {
						// Loading comes before every request, so its row goes first, and only when a load happens.
						const row = rows.get('model') ?? statusList.createEl('li', { prepend: true });
						rows.set('model', row);
						row.setText(MODEL_STATUS_TEXT[status]);
						return;
					}
					const row = rows.get(name);
					if (!row) return;
					if (status === 'skipped') row.remove();
					else row.setText(`${REQUEST_LABELS[name]}: ${STATUS_LABELS[status]}`);
				},
				onDelta: (text) => live.append(text),
				confirmLongNote: (oversized) => confirmLongNote(this.app, oversized),
				resolveCollision: (path) => askCollision(this.app, path),
			},
		);
		// The popup may have been closed while the run was in flight.
		if (this.step !== 'running') return;

		switch (outcome.kind) {
			case 'preview':
				this.renderPreview(outcome.preview);
				return;
			case 'saved':
				new Notice(`Created ${outcome.file.path}`);
				this.close();
				return;
			case 'declined':
				this.error = ['Nothing was sent.'];
				this.renderSetup();
				return;
			case 'cancelled':
				this.renderSetup();
				return;
			case 'failed':
				// 8.0.6: show the error and keep every selection, so Run can be tried again.
				this.error = [outcome.error.message, ...outcome.notices];
				this.renderSetup();
				return;
		}
	}

	// --- Preview ---------------------------------------------------------

	private renderPreview(preview: RunPreview): void {
		this.step = 'preview';
		this.preview = preview;
		const el = this.reset('Preview', true);
		el.createEl('p', { cls: 'im-path', text: `Saves to ${preview.path}` });

		if (preview.warnings.length > 0) {
			const strip = el.createDiv({ cls: 'im-warnings', attr: { role: 'status' } });
			const list = strip.createEl('ul');
			for (const warning of preview.warnings) list.createEl('li', { text: warning });
		}

		this.previewEditor = createMarkdownEditor(el.createDiv({ cls: 'im-editor' }), preview.text, { readOnly: false, label: 'Note to save' });
		this.editors.push(this.previewEditor);

		new Setting(el)
			.addButton((b) => b.setButtonText('Back').onClick(() => this.renderSetup()))
			.addButton((b) => b.setButtonText('Discard').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText('Save')
					.setCta()
					.onClick(() => void this.save()),
			);
		this.primaryAction = () => void this.save();
		this.previewEditor.view.focus();
	}

	private async save(): Promise<void> {
		const preview = this.preview;
		const editor = this.previewEditor;
		if (!preview || !editor) return;
		try {
			const file = await this.ctx.controller.save(preview, editor.getText());
			new Notice(`Created ${file.path}`);
			this.close();
		} catch (error) {
			new Notice(`Couldn't save the note: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

