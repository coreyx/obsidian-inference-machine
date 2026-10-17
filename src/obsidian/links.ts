import type { App, TFile } from 'obsidian';

/**
 * The link back to the source note, written the way the vault's link
 * settings say (Q16): wikilink or Markdown, shortest or relative path. The
 * planned output path is passed as the link's location, so a relative link
 * is correct from where the new note will be.
 */
export function sourceLink(app: App, source: TFile, outputPath: string): string {
	return app.fileManager.generateMarkdownLink(source, outputPath);
}
