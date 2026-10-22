import { describe, expect, it } from 'vitest';
import { alreadyEmbedded, findLeadingImages } from '../../src/core/leading-images';

const targets = (body: string) => findLeadingImages(body).map((image) => image.target);

describe('findLeadingImages (Q40 to Q42)', () => {
	it('reads wikilink embeds with a size or caption', () => {
		expect(findLeadingImages('![[cover.png|300]]\n![[Folder/a.JPG|A caption]]\nText')).toEqual([
			{ raw: '![[cover.png|300]]', form: 'wiki', target: 'cover.png', display: '300', external: false },
			{ raw: '![[Folder/a.JPG|A caption]]', form: 'wiki', target: 'Folder/a.JPG', display: 'A caption', external: false },
		]);
	});

	it('reads Markdown embeds of vault files and URLs', () => {
		expect(findLeadingImages('![Alt](a.png) ![](<my photo.webp>) ![](my%20pic.jpeg "Title") ![](https://example.com/x?id=1)')).toEqual([
			{ raw: '![Alt](a.png)', form: 'markdown', target: 'a.png', display: 'Alt', external: false },
			{ raw: '![](<my photo.webp>)', form: 'markdown', target: 'my photo.webp', external: false },
			{ raw: '![](my%20pic.jpeg "Title")', form: 'markdown', target: 'my pic.jpeg', external: false },
			{ raw: '![](https://example.com/x?id=1)', form: 'markdown', target: 'https://example.com/x?id=1', external: true },
		]);
	});

	it('skips blank lines and headings before and between images (Q40 C)', () => {
		expect(targets('\n# Title\n\n![[a.png]]\n\n## Intro\n![[b.svg]]\nFirst paragraph.\n![[c.png]]')).toEqual(['a.png', 'b.svg']);
	});

	it('stops at the first content that isn\'t an image', () => {
		for (const first of ['Text', '- item', '> quote', '> [!note]', '| a | b |', '```', '    ![[indented.png]]', '![[a.png]] and text', '![[Other note]]', '![](Note.md)'])
			expect(targets(`${first}\n![[late.png]]`), first).toEqual([]);
		expect(targets('![[a.png]] ![[Other note]]\n![[b.png]]')).toEqual([]);
	});

	it('ignores HTML images, a subpath, and malformed encoding', () => {
		expect(targets('<img src="a.png">\n![[b.png]]')).toEqual([]);
		expect(targets('![[a.png#x]] ![](b%E0.png)')).toEqual(['a.png', 'b%E0.png']);
		expect(targets('![[a.txt]]')).toEqual([]);
		expect(targets('')).toEqual([]);
	});
});

describe('alreadyEmbedded (Q46)', () => {
	it('matches a vault file by filename, ignoring path, size, case and subpath', () => {
		expect(alreadyEmbedded('Intro\n![[Attachments/Cover.PNG|200]]', ['cover.png'])).toBe(true);
		expect(alreadyEmbedded('![x](../a/cover.png#y)', ['Attachments/cover.png'])).toBe(true);
		expect(alreadyEmbedded('[[cover.png]] is linked, not embedded', ['cover.png'])).toBe(false);
	});

	it('matches a URL only exactly, and ignores code blocks', () => {
		expect(alreadyEmbedded('![](https://a.example/x.png)', ['https://a.example/x.png'])).toBe(true);
		expect(alreadyEmbedded('![](https://b.example/x.png)', ['https://a.example/x.png'])).toBe(false);
		expect(alreadyEmbedded('```\n![[cover.png]]\n```', ['cover.png'])).toBe(false);
	});
});
