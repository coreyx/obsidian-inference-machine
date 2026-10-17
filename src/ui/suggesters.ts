import { AbstractInputSuggest, FuzzySuggestModal, TFolder, type App, type TFile } from 'obsidian';

/** Picks any Markdown note in the vault by fuzzy name search (2.0.2). */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder('Find a note to derive from');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

/** Suggests vault folders while typing an output folder (10.0.1). */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly onPick: (path: string) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TFolder[] {
		const needle = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path.toLowerCase().includes(needle))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.input.value = folder.path;
		this.onPick(folder.path);
		this.close();
	}
}
