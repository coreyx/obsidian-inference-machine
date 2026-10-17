import { Modal, Setting, type App } from 'obsidian';
import { DEFAULTS } from '../core/defaults';
import { collectTemplatePrompts } from '../core/inline';
import { resolveRunConfig, type RunConfig } from '../core/resolve';
import { PROPERTY_TYPES, type PropertyType, type TagFormat, type TaggingSettings, type Template } from '../core/schema';
import type { SettingsStore } from '../obsidian/settings-store';
import { FolderSuggest } from './suggesters';
import { createTemplateField, type TemplateFieldEditor, type TemplateFieldOptions } from './template-field';

/** Booleans a template can set or inherit (design decision 3). */
type TriState = boolean | undefined;

/** Adds an Inherit / On / Off dropdown to a setting, naming the inherited value. */
function triState(setting: Setting, value: TriState, inherited: boolean, onChange: (value: TriState) => void): Setting {
	return setting.addDropdown((d) =>
		d
			.addOption('inherit', `Inherit (${inherited ? 'on' : 'off'})`)
			.addOption('on', 'On')
			.addOption('off', 'Off')
			.setValue(value === undefined ? 'inherit' : value ? 'on' : 'off')
			.onChange((v) => onChange(v === 'inherit' ? undefined : v === 'on')),
	);
}

const FORMAT_LABELS: Record<Exclude<TagFormat, { custom: string }>, string> = {
	kebab: 'kebab-case',
	snake: 'snake_case',
	camel: 'camelCase',
	pascal: 'PascalCase',
};

/** How a tag format reads in a dropdown. */
export function formatLabel(format: TagFormat): string {
	return typeof format === 'object' ? 'Custom' : FORMAT_LABELS[format];
}

/**
 * Edits one template (5.0.1, 5.0.2): its prompts, filename, body wrapper and
 * properties in CodeMirror fields with highlighting and lint marks (6.0.4,
 * 21.0.7), and every overridable setting as an Inherit / value control.
 */
export class TemplateEditorModal extends Modal {
	private draft: Template;
	private fields: TemplateFieldEditor[] = [];
	private error = '';

	constructor(
		app: App,
		private readonly store: SettingsStore,
		template: Template,
		private readonly onSaved: () => void,
	) {
		super(app);
		this.draft = structuredClone(template);
	}

	override onOpen(): void {
		this.modalEl.addClass('inference-machine-modal', 'is-large', 'im-template-editor');
		this.render();
	}

	override onClose(): void {
		this.destroyFields();
		this.contentEl.empty();
	}

	private destroyFields(): void {
		for (const field of this.fields) field.destroy();
		this.fields = [];
	}

	/** What each setting would be if the template left it unset. */
	private inherited(): RunConfig {
		const data = this.store.data;
		return resolveRunConfig({
			popup: {},
			template: { id: this.draft.id, name: this.draft.name },
			globalSettings: data.globalSettings,
			engines: data.engines,
			defaultEngineId: data.defaultEngineId,
		}).config;
	}

	private render(): void {
		this.destroyFields();
		const el = this.contentEl;
		el.empty();
		this.setTitle(`Edit template "${this.draft.name}"`);
		const draft = this.draft;
		const inherited = this.inherited();
		const scroller = el.createDiv({ cls: 'im-editor-scroll' });

		if (draft.origin) {
			scroller.createEl('p', {
				cls: 'setting-item-description',
				text: 'This is a built-in template. While you leave it unedited, plugin updates can improve it. Once you edit it, your version is kept.',
			});
		}

		new Setting(scroller).setName('Name').addText((t) => t.setValue(draft.name).onChange((v) => (draft.name = v)));

		this.field(scroller, 'Main prompt', 'What the model is asked to write. Leave it empty to use only inline prompts. When it doesn\'t use {{content}} or {{body}}, the note\'s filename and contents are added after it.', {
			value: draft.prompt ?? '',
			field: 'prompt',
			placeholder: 'Summarize this note.',
			onChange: (v) => (draft.prompt = v),
		});
		this.field(scroller, 'Prompt context', 'Sent with the inline prompts, so they can answer from the note.', {
			value: draft.context ?? '',
			field: 'context',
			placeholder: DEFAULTS.context.replace('\n\n', ' '),
			compact: true,
			onChange: (v) => setOptional(draft, 'context', v),
		});
		this.field(scroller, 'Filename', 'The new note\'s name. Leave empty to inherit.', {
			value: draft.noteNameFormat ?? '',
			field: 'output',
			placeholder: inherited.noteNameFormat,
			compact: true,
			onChange: (v) => setOptional(draft, 'noteNameFormat', v),
		});
		this.field(scroller, 'Body', 'The new note\'s body. {{output}} places the main output.', {
			value: draft.noteContentFormat ?? '',
			field: 'output',
			placeholder: DEFAULTS.noteContentFormat,
			onChange: (v) => setOptional(draft, 'noteContentFormat', v),
		});

		this.renderProperties(scroller);
		this.renderOutput(scroller, inherited);
		this.renderTagging(scroller, inherited);

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

	private field(el: HTMLElement, name: string, desc: string, options: Omit<TemplateFieldOptions, 'label'>): void {
		const setting = new Setting(el).setName(name).setDesc(desc);
		setting.settingEl.addClass('im-field-setting');
		const container = el.createDiv({ cls: 'im-field' });
		this.fields.push(createTemplateField(container, { ...options, label: name }));
	}

	private renderProperties(el: HTMLElement): void {
		const draft = this.draft;
		new Setting(el).setName('Properties').setDesc('Frontmatter for the new note. Values can use variables and inline prompts. A "tags" property adds tags through the tag pipeline.').setHeading();
		const properties = (draft.properties ??= []);
		properties.forEach((property, index) => {
			const row = new Setting(el).addText((t) => t.setPlaceholder('Name').setValue(property.name).onChange((v) => (property.name = v.trim())));
			row.addDropdown((d) => {
				for (const type of PROPERTY_TYPES) d.addOption(type, type);
				d.setValue(property.type).onChange((v) => (property.type = v as PropertyType));
			});
			row.addExtraButton((b) =>
				b
					.setIcon('trash-2')
					.setTooltip('Remove property')
					.onClick(() => {
						properties.splice(index, 1);
						this.render();
					}),
			);
			const container = el.createDiv({ cls: 'im-field' });
			this.fields.push(
				createTemplateField(container, {
					value: property.value,
					field: 'output',
					label: `Value of ${property.name || 'property'}`,
					placeholder: 'Value, such as {{properties.author}} or {{"a one-sentence description"}}',
					compact: true,
					onChange: (v) => (property.value = v),
				}),
			);
		});
		new Setting(el).addButton((b) =>
			b.setButtonText('Add property').onClick(() => {
				properties.push({ name: '', value: '', type: 'text' });
				this.render();
			}),
		);
		new Setting(el)
			.setName('Leave out empty properties')
			.setDesc('Don\'t write a property whose value comes out empty.')
			.then((s) => triState(s, draft.omitEmptyProperties, DEFAULTS.omitEmptyProperties, (v) => setOptional(draft, 'omitEmptyProperties', v)));
	}

	private renderOutput(el: HTMLElement, inherited: RunConfig): void {
		const draft = this.draft;
		const data = this.store.data;
		new Setting(el).setName('Output').setHeading();

		new Setting(el).setName('Engine').addDropdown((d) => {
			const fallback = data.engines.find((e) => e.id === data.defaultEngineId);
			d.addOption('', `Inherit (${fallback?.name ?? 'default engine'})`);
			for (const engine of data.engines) d.addOption(engine.id, engine.name);
			d.setValue(draft.engineId && data.engines.some((e) => e.id === draft.engineId) ? draft.engineId : '');
			d.onChange((id) => setOptional(draft, 'engineId', id));
		});

		const location = new Setting(el).setName('Location');
		location.addDropdown((d) => {
			const inheritedText = inherited.location.mode === 'folder' ? inherited.location.path || 'vault root' : 'next to the source';
			d.addOption('inherit', `Inherit (${inheritedText})`).addOption('alongside', 'Next to the source note').addOption('folder', 'In a folder');
			d.setValue(draft.location?.mode ?? 'inherit').onChange((mode) => {
				if (mode === 'inherit') delete draft.location;
				else draft.location = mode === 'folder' ? { mode: 'folder', path: '' } : { mode: 'alongside' };
				this.render();
			});
		});
		if (draft.location?.mode === 'folder') {
			const current = draft.location;
			location.addText((t) => {
				t.setPlaceholder('Folder').setValue(current.path);
				const set = (path: string) => (current.path = path);
				t.onChange(set);
				new FolderSuggest(this.app, t.inputEl, set);
			});
		}

		triState(new Setting(el).setName('Skip preview').setDesc('Save the note straight after the run.'), draft.skipPreview, false, (v) => setOptional(draft, 'skipPreview', v));
		triState(new Setting(el).setName('Open the new note'), draft.openAfterCreate, inherited.openAfterCreate, (v) => setOptional(draft, 'openAfterCreate', v));
		const references = (draft.references ??= {});
		triState(new Setting(el).setName('Link back to the source'), references.enabled, inherited.references.enabled, (v) => {
			if (v === undefined) delete references.enabled;
			else references.enabled = v;
		});
		new Setting(el)
			.setName('References heading')
			.setDesc('Leave empty to inherit.')
			.addText((t) =>
				t
					.setPlaceholder(inherited.references.heading)
					.setValue(references.heading ?? '')
					.onChange((v) => {
						if (v.trim() === '') delete references.heading;
						else references.heading = v.trim();
					}),
			);
	}

	private renderTagging(el: HTMLElement, inherited: RunConfig): void {
		const tagging = (this.draft.tagging ??= {});
		const t = inherited.tagging;
		new Setting(el).setName('Tags').setHeading();
		const bool = (name: string, key: keyof Pick<TaggingSettings, 'mergeSourceTags' | 'aiTagging' | 'applyFormatToSource' | 'hierarchicalPrefixes' | 'reuseVaultTags' | 'existingOnly'>, desc?: string) => {
			const setting = new Setting(el).setName(name);
			if (desc) setting.setDesc(desc);
			triState(setting, tagging[key], t[key], (v) => {
				if (v === undefined) delete tagging[key];
				else tagging[key] = v;
			});
		};
		bool('Merge source tags', 'mergeSourceTags');
		bool('AI tagging', 'aiTagging', 'Ask the engine for tags in a separate request.');

		const format = new Setting(el).setName('Tag format');
		format.addDropdown((d) => {
			d.addOption('inherit', `Inherit (${formatLabel(t.format)})`);
			for (const [value, label] of Object.entries(FORMAT_LABELS)) d.addOption(value, label);
			d.addOption('custom', 'Custom');
			const current = tagging.format;
			d.setValue(current === undefined ? 'inherit' : typeof current === 'object' ? 'custom' : current);
			d.onChange((v) => {
				if (v === 'inherit') delete tagging.format;
				else tagging.format = v === 'custom' ? { custom: typeof current === 'object' ? current.custom : '' } : (v as TagFormat);
				this.render();
			});
		});
		if (typeof tagging.format === 'object') {
			const custom = tagging.format;
			format.addText((text) => text.setPlaceholder('Describe the format').setValue(custom.custom).onChange((v) => (custom.custom = v)));
		}
		bool('Apply the format to source tags', 'applyFormatToSource');
		bool('Hierarchical prefixes', 'hierarchicalPrefixes');
		bool('Reuse vault tags first', 'reuseVaultTags');
		bool('Existing tags only', 'existingOnly');

		new Setting(el)
			.setName('Number of AI tags')
			.setDesc('Leave empty to inherit.')
			.addText((text) => countField(text.inputEl, tagging.minTags, t.minTags, (n) => setOptional(tagging, 'minTags', n)))
			.addText((text) => countField(text.inputEl, tagging.maxTags, t.maxTags, (n) => setOptional(tagging, 'maxTags', n)));
		new Setting(el)
			.setName('Preferred tags')
			.setDesc('Tags the AI should favor when they fit, separated by commas.')
			.addText((text) =>
				text.setValue((tagging.preferredTags ?? []).join(', ')).onChange((v) => {
					const list = v
						.split(',')
						.map((tag) => tag.trim().replace(/^#/u, ''))
						.filter((tag) => tag !== '');
					setOptional(tagging, 'preferredTags', list.length > 0 ? list : undefined);
				}),
			);
	}

	private async save(): Promise<void> {
		const draft = this.draft;
		draft.name = draft.name.trim();
		if (draft.name === '') {
			this.error = 'Give the template a name.';
			this.render();
			return;
		}
		if (draft.prompt !== undefined && draft.prompt.trim() === '') delete draft.prompt;
		draft.properties = (draft.properties ?? []).filter((p) => p.name !== '');
		if (draft.properties.length === 0) delete draft.properties;
		if (draft.references && Object.keys(draft.references).length === 0) delete draft.references;
		if (draft.tagging && Object.keys(draft.tagging).length === 0) delete draft.tagging;

		// 5.0.2: a template needs a main prompt, at least one inline prompt, or both.
		const config = this.inherited();
		const prompts = collectTemplatePrompts({
			noteNameFormat: draft.noteNameFormat ?? config.noteNameFormat,
			propertyValues: (draft.properties ?? []).map((p) => p.value),
			noteContentFormat: draft.noteContentFormat ?? DEFAULTS.noteContentFormat,
		});
		if (!draft.prompt && prompts.length === 0) {
			this.error = 'Add a main prompt, or at least one inline prompt such as {{"a one-sentence description"}}.';
			this.render();
			return;
		}

		await this.store.update((data) => {
			const index = data.templates.findIndex((t) => t.id === draft.id);
			if (index === -1) data.templates.push(draft);
			else data.templates[index] = draft;
		});
		this.onSaved();
		this.close();
	}
}

/** Sets an optional field, deleting it when the value means "inherit" (empty text or undefined). */
function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | '' | undefined): void {
	if (value === undefined || value === '') delete target[key];
	else target[key] = value;
}

/** A small number input for a tag count, showing the inherited value as its placeholder. */
function countField(input: HTMLInputElement, value: number | undefined, inherited: number, set: (n: number | undefined) => void): void {
	input.type = 'number';
	input.min = '1';
	input.addClass('im-count');
	input.placeholder = String(inherited);
	input.value = value === undefined ? '' : String(value);
	input.addEventListener('input', () => {
		const n = Number(input.value);
		set(input.value.trim() === '' || !Number.isInteger(n) || n < 1 ? undefined : n);
	});
}
