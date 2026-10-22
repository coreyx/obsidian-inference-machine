import { describe, expect, it } from 'vitest';
import { findLeadingImages } from '../../src/core/leading-images';
import { imageEmbed, sourceLink } from '../../src/obsidian/links';
import { readNote } from '../../src/obsidian/note-reader';
import { createNote, ensureFolder, fileAt, notePath, openNote, outputFolder, planPath } from '../../src/obsidian/note-writer';
import { Secrets, secretIdFrom } from '../../src/obsidian/secrets';
import { VaultTagIndex } from '../../src/obsidian/tag-index';
import { FakeApp } from '../fake-app';

const alphaText = '---\ntags: [Project, area/work]\nauthor: Ada\n---\n# Alpha\n\nAn #idea and a second #Project mention.\n';

describe('readNote', () => {
	it('snapshots the note with both tag forms, in order', async () => {
		const fake = new FakeApp({ 'Projects/Alpha.md': alphaText });
		const note = await readNote(fake.app, fake.file('Projects/Alpha.md'));
		expect(note).toMatchObject({
			title: 'Alpha',
			path: 'Projects/Alpha.md',
			folder: 'Projects',
			content: alphaText,
			body: '# Alpha\n\nAn #idea and a second #Project mention.\n',
			frontmatterText: 'tags: [Project, area/work]\nauthor: Ada',
			properties: { tags: ['Project', 'area/work'], author: 'Ada' },
			frontmatterTags: ['Project', 'area/work'],
			inlineTags: ['idea', 'Project'],
		});
		expect(note.mtime).toBeGreaterThan(0);
		expect(fake.writes).toEqual([]);
	});

	it('splits tags written as one string, which Obsidian itself would drop (11.4)', async () => {
		const cases: [string, string[]][] = [
			['"alpha, beta"', ['alpha', 'beta']],
			['"alpha beta"', ['alpha', 'beta']],
			['"alpha,beta"', ['alpha', 'beta']],
			['"#alpha"', ['alpha']],
			['single', ['single']],
			['[one, "#two"]', ['one', 'two']],
		];
		for (const [value, expected] of cases) {
			const fake = new FakeApp({ 'T.md': `---\ntags: ${value}\n---\nText` });
			expect((await readNote(fake.app, fake.file('T.md'))).frontmatterTags, value).toEqual(expected);
		}
		const legacy = new FakeApp({ 'L.md': '---\ntag: "x, y"\n---\nText' });
		expect((await readNote(legacy.app, legacy.file('L.md'))).frontmatterTags).toEqual(['x', 'y']);
	});

	it('reads tags written as a single string (11.4)', async () => {
		const fake = new FakeApp({ 'Beta.md': '---\ntags: "alpha, beta"\n---\nText' });
		const note = await readNote(fake.app, fake.file('Beta.md'));
		expect(note.frontmatterTags).toEqual(['alpha', 'beta']);
		expect(note.folder).toBe('');
	});

	it('handles a note without frontmatter', async () => {
		const fake = new FakeApp({ 'Plain.md': 'Just text' });
		const note = await readNote(fake.app, fake.file('Plain.md'));
		expect(note).toMatchObject({ body: 'Just text', frontmatterText: '', properties: {}, frontmatterTags: [], inlineTags: [] });
	});
});

describe('VaultTagIndex', () => {
	function index(fake: FakeApp) {
		const tags = new VaultTagIndex(fake.app);
		tags.attach(() => undefined);
		return tags;
	}

	it('is not built until something asks for tags (14.1)', () => {
		const fake = new FakeApp({ 'A.md': '#x' });
		const tags = index(fake);
		fake.edit('A.md', '#y');
		expect(tags.built).toBe(false);
		tags.ranked(10);
		expect(tags.built).toBe(true);
	});

	it('ranks tags by use and lists every prefix (14.4)', () => {
		const fake = new FakeApp({
			'A.md': '---\ntags: [ai/llm]\n---\n#reading #dev/frontend/react',
			'B.md': '#reading #ai/llm',
			'C.md': '#reading',
		});
		const tags = index(fake);
		expect(tags.ranked(1000)).toEqual(['reading', 'ai/llm', 'dev/frontend/react']);
		expect(tags.ranked(1)).toEqual(['reading']);
		expect(tags.prefixes()).toEqual(['ai/', 'dev/', 'dev/frontend/']);
	});

	it('stays current as notes change, are deleted or renamed', () => {
		const fake = new FakeApp({ 'A.md': '#old #shared', 'B.md': '#shared' });
		const tags = index(fake);
		expect(tags.ranked(10)).toEqual(['shared', 'old']);
		fake.edit('A.md', '#new');
		expect(tags.ranked(10)).toEqual(['new', 'shared']);
		const b = fake.files.get('B.md')!.file;
		fake.trigger('vault:rename', b, 'B.md');
		b.path = 'Renamed.md';
		fake.trigger('vault:rename', b, 'B.md');
		fake.trigger('metadata:deleted', b);
		expect(tags.ranked(10)).toEqual(['new']);
		// Renaming something the index doesn't track is ignored.
		fake.trigger('vault:rename', fake.folders.get('/'), 'x');
		fake.trigger('vault:rename', b, 'never-indexed.md');
	});
});

describe('note writer', () => {
	const source = { folder: 'Projects' } as Parameters<typeof outputFolder>[1];

	it('puts the note in the chosen folder or next to the source (10.1, 10.2)', () => {
		expect(outputFolder({ mode: 'folder', path: ' Summaries/ ' }, source)).toBe('Summaries');
		expect(outputFolder({ mode: 'alongside' }, source)).toBe('Projects');
		expect(outputFolder({ mode: 'folder', path: '/' }, source)).toBe('');
		expect(notePath('', 'Alpha')).toBe('Alpha.md');
	});

	it('numbers a taken name until it is free (10.4)', async () => {
		const fake = new FakeApp({ 'Projects/Alpha - Summary.md': 'x', 'Projects/Alpha - Summary 1.md': 'x' });
		expect(await planPath(fake.app, 'Projects', 'Alpha - Summary')).toBe('Projects/Alpha - Summary 2.md');
		expect(await planPath(fake.app, 'Projects', 'Fresh: name?')).toBe('Projects/Fresh name.md');
	});

	it('treats a name that differs only in case as taken', async () => {
		const fake = new FakeApp({ 'alpha.md': 'x' });
		expect(await planPath(fake.app, '', 'Alpha')).toBe('Alpha 1.md');
	});

	it('creates every missing folder level, then the note', async () => {
		const fake = new FakeApp({ 'Notes/Existing.md': 'x' });
		const file = await createNote(fake.app, 'Notes/Deep/Deeper/New.md', 'text');
		expect(file.path).toBe('Notes/Deep/Deeper/New.md');
		expect(fake.writes).toEqual([
			{ op: 'createFolder', path: 'Notes/Deep' },
			{ op: 'createFolder', path: 'Notes/Deep/Deeper' },
			{ op: 'create', path: 'Notes/Deep/Deeper/New.md' },
		]);
		await ensureFolder(fake.app, '');
		await expect(ensureFolder(fake.app, 'Notes/Existing.md/sub')).rejects.toThrow(/is a file/u);
		await expect(createNote(fake.app, 'Notes/Existing.md', 'y')).rejects.toThrow();
	});

	it('opens the note only when asked, in a new tab (10.8)', async () => {
		const fake = new FakeApp({ 'A.md': 'x' });
		const file = fileAt(fake.app, 'A.md')!;
		await openNote(fake.app, file);
		expect(fake.opened).toEqual(['A.md']);
		expect(fileAt(fake.app, '/')).toBeUndefined();
	});
});

describe('links and secrets', () => {
	it('builds the source link with the vault\'s link settings', () => {
		const fake = new FakeApp({ 'Projects/Alpha.md': 'x' });
		expect(sourceLink(fake.app, fileAt(fake.app, 'Projects/Alpha.md')!, 'Projects/Alpha - Summary.md')).toBe('[[Alpha]]');
	});

	it('relinks a leading image for the new note, keeping its size, and keeps URLs and unknown files as written (Q45)', () => {
		const fake = new FakeApp({ 'Reading/Dune.md': 'x', 'Attachments/my cover.png': 'png' });
		const source = fileAt(fake.app, 'Reading/Dune.md')!;
		const [wiki, relative, url, missing] = findLeadingImages(
			'![[my cover.png|200]] ![Cover](../Attachments/my%20cover.png) ![](https://example.com/c.jpg) ![[gone.png]]',
		);
		expect(imageEmbed(fake.app, source, wiki!, 'Summaries/Dune - Summary.md')).toEqual({
			embed: '![[my cover.png|200]]',
			targets: ['my cover.png', 'Attachments/my cover.png'],
		});
		fake.linkStyle = 'markdown';
		expect(imageEmbed(fake.app, source, relative!, 'Summaries/Deep/Dune - Summary.md').embed).toBe('![Cover](../../Attachments/my%20cover.png)');
		expect(imageEmbed(fake.app, source, url!, 'Summaries/Dune - Summary.md')).toEqual({
			embed: '![](https://example.com/c.jpg)',
			targets: ['https://example.com/c.jpg'],
		});
		expect(imageEmbed(fake.app, source, missing!, 'Summaries/Dune - Summary.md')).toEqual({ embed: '![[gone.png]]', targets: ['gone.png'] });
	});

	it('reads and writes SecretStorage, and makes valid ids', () => {
		const fake = new FakeApp();
		const secrets = new Secrets(fake.app);
		secrets.set('anthropic', 'sk-ant');
		expect(secrets.get('anthropic')).toBe('sk-ant');
		expect(secrets.get('missing')).toBeUndefined();
		expect(secrets.list()).toEqual(['anthropic']);
		expect(secretIdFrom('My Claude Key!')).toBe('my-claude-key');
		expect(secretIdFrom('!!!')).toBe('inference-machine-key');
	});
});
