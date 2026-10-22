import type { App, TFile } from 'obsidian';
import type { CarriedImage, LeadingImage } from '../core/leading-images';

/**
 * The link back to the source note, written the way the vault's link
 * settings say (Q16): wikilink or Markdown, shortest or relative path. The
 * planned output path is passed as the link's location, so a relative link
 * is correct from where the new note will be.
 */
export function sourceLink(app: App, source: TFile, outputPath: string): string {
	return app.fileManager.generateMarkdownLink(source, outputPath);
}

/**
 * Writes a leading image's embed for the new note (Q45). A vault image gets a
 * new link from the vault's link settings, written for the output path like
 * the source link, so a relative path still reaches the image from another
 * folder; its size or caption is kept as the link's display text. A URL, and
 * a link that matches no file, are kept exactly as the source wrote them.
 */
export function imageEmbed(app: App, source: TFile, image: LeadingImage, outputPath: string): CarriedImage {
	if (image.external) return { embed: image.raw, targets: [image.target] };
	const file = app.metadataCache.getFirstLinkpathDest(image.target, source.path);
	if (!file) return { embed: image.raw, targets: [image.target] };
	const link = app.fileManager.generateMarkdownLink(file, outputPath, undefined, image.display);
	// The link is generated as a plain link; the leading ! makes it an embed.
	return { embed: link.startsWith('!') ? link : `!${link}`, targets: [image.target, file.path] };
}
