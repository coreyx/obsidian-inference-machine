/**
 * Finds the images at the front of a note, so a derived note can carry them
 * over (spec/carry-over-from-source, Q40 to Q46). An image is at the front
 * when nothing but headings, blank lines and other images comes before it, so
 * a cover or banner under the note's title still counts.
 */

/** An image embed found at the front of a note. */
export interface LeadingImage {
	/** The embed exactly as the note writes it. */
	raw: string;
	/** `![[…]]` or `![…](…)`. */
	form: 'wiki' | 'markdown';
	/** The vault path or URL, decoded, without any `#subpath`. */
	target: string;
	/** The size or caption after `|` in a wikilink, or the alt text in Markdown. */
	display?: string;
	/** True for an `http://` or `https://` URL. */
	external: boolean;
}

/** A leading image's embed as written in the new note, with the targets that identify it. */
export interface CarriedImage {
	embed: string;
	/** The source's target, and the resolved file's path when there is one, for spotting duplicates. */
	targets: string[];
}

/** The image formats Obsidian shows when embedded. */
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

const WIKI_EMBED = /!\[\[([^\]\n]+?)\]\]/uy;
// A destination is either wrapped in <…>, which allows spaces, or has none. An optional "title" may follow.
const MARKDOWN_EMBED = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\s*\)/uy;
const EXTERNAL = /^https?:\/\//iu;

/** Any embed, image or not, as written at one position in a line. */
interface Embed {
	raw: string;
	form: 'wiki' | 'markdown';
	target: string;
	display?: string;
	external: boolean;
	end: number;
}

/** Reads the embed starting at `index`, if there is one. */
function embedAt(line: string, index: number): Embed | undefined {
	WIKI_EMBED.lastIndex = index;
	const wiki = WIKI_EMBED.exec(line);
	if (wiki) {
		const inner = wiki[1]!;
		const bar = inner.indexOf('|');
		const link = bar === -1 ? inner : inner.slice(0, bar);
		const display = bar === -1 ? undefined : inner.slice(bar + 1);
		return {
			raw: wiki[0],
			form: 'wiki',
			target: withoutSubpath(link.trim()),
			...(display !== undefined ? { display } : {}),
			external: false,
			end: WIKI_EMBED.lastIndex,
		};
	}
	MARKDOWN_EMBED.lastIndex = index;
	const markdown = MARKDOWN_EMBED.exec(line);
	if (markdown) {
		let destination = markdown[2]!;
		if (destination.startsWith('<')) destination = destination.slice(1, -1);
		const external = EXTERNAL.test(destination);
		return {
			raw: markdown[0],
			form: 'markdown',
			target: external ? destination : withoutSubpath(decode(destination)),
			...(markdown[1] !== '' ? { display: markdown[1] } : {}),
			external,
			end: MARKDOWN_EMBED.lastIndex,
		};
	}
	return undefined;
}

/** Decodes a percent-encoded path such as `my%20photo.png`, leaving a malformed one as written. */
function decode(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

/** Drops a `#heading` or `#^block` from a link target. */
function withoutSubpath(target: string): string {
	const hash = target.indexOf('#');
	return hash === -1 ? target : target.slice(0, hash);
}

/** Whether an embed shows an image: any URL, or a vault file with an image extension. */
function isImage(embed: Embed): boolean {
	if (embed.external) return embed.form === 'markdown';
	const extension = /\.([^./]+)$/u.exec(embed.target)?.[1];
	return extension !== undefined && IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Reads a line made of nothing but embeds and whitespace. Returns undefined
 * when anything else is on the line.
 */
function embedsOnLine(line: string): Embed[] | undefined {
	const embeds: Embed[] = [];
	let index = 0;
	while (index < line.length) {
		if (/\s/u.test(line[index]!)) {
			index++;
			continue;
		}
		const embed = embedAt(line, index);
		if (!embed) return undefined;
		embeds.push(embed);
		index = embed.end;
	}
	return embeds;
}

/** An ATX heading, such as `## Notes`, indented by up to three spaces. */
function isHeading(line: string): boolean {
	return /^ {0,3}#{1,6}(?:[ \t]|$)/u.test(line);
}

/** Whether a line opens or closes a fenced code block. */
function isFence(line: string): boolean {
	return /^ {0,3}(`{3,}|~{3,})/u.test(line);
}

/**
 * The images at the front of a note body (the body without frontmatter), in
 * order (Q40, Q41). Blank lines and headings are skipped; a line holding only
 * image embeds adds them; anything else ends the search, as does a line
 * indented as code. A note embed such as `![[Other note]]` counts as content.
 */
export function findLeadingImages(body: string): LeadingImage[] {
	const images: LeadingImage[] = [];
	for (const line of body.split('\n')) {
		if (line.trim() === '' || isHeading(line)) continue;
		if (/^(?: {4}|\t)/u.test(line)) break;
		const embeds = embedsOnLine(line);
		if (!embeds || !embeds.every(isImage)) break;
		for (const { raw, form, target, display, external } of embeds) {
			images.push({ raw, form, target, ...(display !== undefined ? { display } : {}), external });
		}
	}
	return images;
}

/** The part of a target that identifies it: a URL whole, a vault path by its lowercased filename. */
function identity(target: string): string {
	if (EXTERNAL.test(target)) return target;
	return (target.split('/').pop() ?? target).toLowerCase();
}

/**
 * Whether the body already embeds any of the targets, outside code blocks
 * (Q46). A model often repeats the source's embeds, and the image shouldn't
 * then appear twice. Vault paths match by filename, since the output may link
 * the same file by a shorter or longer path than the source did.
 */
export function alreadyEmbedded(body: string, targets: readonly string[]): boolean {
	const wanted = new Set(targets.map(identity));
	let inFence = false;
	for (const line of body.split('\n')) {
		if (isFence(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		for (let index = line.indexOf('!['); index !== -1; index = line.indexOf('![', index + 2)) {
			const embed = embedAt(line, index);
			if (embed && wanted.has(identity(embed.target))) return true;
		}
	}
	return false;
}
