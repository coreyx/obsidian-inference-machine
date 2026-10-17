import { markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageSupport } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

/**
 * CodeMirror 6 editors for the popup (tech.md, "Editors"): a read-only view
 * that shows the main output as it streams in, and the preview editor that
 * holds the exact text that will be saved (9.1). Both use the CodeMirror
 * Obsidian ships, styled with Obsidian's theme variables (19.0.1).
 */

/** Styling that follows the active Obsidian theme. */
const obsidianTheme = EditorView.theme({
	'&': { height: '100%', backgroundColor: 'var(--background-primary)', color: 'var(--text-normal)', fontSize: 'var(--font-text-size)' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: 'var(--line-height-normal)' },
	'.cm-content': { caretColor: 'var(--text-normal)', padding: 'var(--size-4-2) 0' },
	'.cm-cursor': { borderLeftColor: 'var(--text-normal)' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--text-selection)' },
	'.cm-gutters': { display: 'none' },
});

/** A Markdown editor in the popup. */
export interface MarkdownEditor {
	view: EditorView;
	/** The editor's whole text. */
	getText(): string;
	/** Adds text at the end and scrolls to it, for streamed output. */
	append(text: string): void;
	destroy(): void;
}

/** Creates a Markdown editor inside `parent`. */
export function createMarkdownEditor(parent: HTMLElement, text: string, options: { readOnly: boolean; label: string }): MarkdownEditor {
	const extensions: Extension[] = [
		// The Markdown language alone: markdown() would also bundle HTML, CSS and
		// JavaScript parsers for fenced code, which a note preview doesn't need.
		new LanguageSupport(markdownLanguage),
		obsidianTheme,
		EditorView.lineWrapping,
		EditorView.contentAttributes.of({ 'aria-label': options.label }),
	];
	if (options.readOnly) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
	else extensions.push(history(), keymap.of([...defaultKeymap, ...historyKeymap]));

	const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions }) });
	return {
		view,
		getText: () => view.state.doc.toString(),
		append: (added) => {
			const end = view.state.doc.length;
			view.dispatch({ changes: { from: end, insert: added }, scrollIntoView: true, selection: { anchor: end + added.length } });
		},
		destroy: () => view.destroy(),
	};
}
