import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { linter, type Diagnostic as EditorDiagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, placeholder as placeholderExtension } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { diagnose, knapStreamParser } from '../core/template/knap';
import type { TemplateField } from '../core/template/variables';

/**
 * A CodeMirror field for one template setting (design.md, "UI design
 * notes"): knap syntax highlighting, and lint marks from `diagnose` for
 * unknown variables, filter problems and misplaced inline prompts (6.0.4,
 * 7.0.3, 21.0.7). The same problems are listed in text under the field, so
 * they're readable without hovering, including on mobile.
 */

const knapLanguage = StreamLanguage.define(knapStreamParser);

/** Template syntax colors from the active theme's code colors (19.0.1). */
const knapHighlight = HighlightStyle.define([
	{ tag: tags.keyword, color: 'var(--code-keyword)' },
	{ tag: [tags.variableName, tags.name], color: 'var(--code-property)' },
	{ tag: tags.propertyName, color: 'var(--code-property)' },
	{ tag: tags.string, color: 'var(--code-string)' },
	{ tag: [tags.number, tags.atom, tags.bool], color: 'var(--code-value)' },
	{ tag: tags.operator, color: 'var(--code-operator)' },
	{ tag: tags.punctuation, color: 'var(--code-punctuation)' },
	{ tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
]);

const fieldTheme = EditorView.theme({
	'&': {
		backgroundColor: 'var(--background-modifier-form-field)',
		border: 'var(--input-border-width) solid var(--background-modifier-border)',
		borderRadius: 'var(--input-radius)',
		color: 'var(--text-normal)',
		fontSize: 'var(--font-ui-small)',
	},
	'&.cm-focused': { outline: 'none', boxShadow: '0 0 0 2px var(--background-modifier-border-focus)' },
	'.cm-scroller': { fontFamily: 'var(--font-monospace)' },
	'.cm-content': { padding: 'var(--size-4-1) 0', caretColor: 'var(--text-normal)' },
	'.cm-placeholder': { color: 'var(--text-faint)' },
	'.cm-gutters': { display: 'none' },
});

/** One template field in the editor. */
export interface TemplateFieldEditor {
	getValue(): string;
	destroy(): void;
}

/** Options for a template field. */
export interface TemplateFieldOptions {
	value: string;
	/** Which variables the field may use (see `knownVariables`). */
	field: TemplateField;
	label: string;
	placeholder?: string;
	/** Shorter fields, such as the filename pattern or a property value. */
	compact?: boolean;
	onChange?: (value: string) => void;
}

/** Converts a 1-based line and column to a document offset. */
function offset(state: EditorState, line: number, column: number): number {
	const docLine = state.doc.line(Math.min(Math.max(line, 1), state.doc.lines));
	return Math.min(docLine.from + Math.max(column - 1, 0), docLine.to);
}

/** Creates a template field inside `parent`, with its problem list under it. */
export function createTemplateField(parent: HTMLElement, options: TemplateFieldOptions): TemplateFieldEditor {
	const host = parent.createDiv({ cls: `im-template-field${options.compact ? ' is-compact' : ''}` });
	const problems = parent.createEl('ul', { cls: 'im-diagnostics', attr: { 'aria-live': 'polite' } });

	const showProblems = (text: string) => {
		problems.empty();
		for (const d of diagnose(text, options.field)) {
			problems.createEl('li', { cls: `is-${d.severity}`, text: `Line ${d.line}: ${d.message}` });
		}
	};

	const extensions: Extension[] = [
		knapLanguage,
		syntaxHighlighting(knapHighlight),
		fieldTheme,
		EditorView.lineWrapping,
		EditorView.contentAttributes.of({ 'aria-label': options.label }),
		linter((view) =>
			diagnose(view.state.doc.toString(), options.field).map((d): EditorDiagnostic => {
				const from = offset(view.state, d.line, d.column);
				return { from, to: Math.min(from + 1, view.state.doc.length), severity: d.severity, message: d.message };
			}),
		),
		EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			const text = update.state.doc.toString();
			showProblems(text);
			options.onChange?.(text);
		}),
	];
	if (options.placeholder) extensions.push(placeholderExtension(options.placeholder));

	const view = new EditorView({ parent: host, state: EditorState.create({ doc: options.value, extensions }) });
	showProblems(options.value);
	return { getValue: () => view.state.doc.toString(), destroy: () => view.destroy() };
}
