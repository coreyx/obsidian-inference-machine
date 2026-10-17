import {
	createEngine,
	standardFilters,
	type ASTNode,
	type Expression,
	type FilterRegistry,
	type TemplateFilter,
} from 'knap';
import { knownVariables, type TemplateField } from './variables';

/**
 * The only module that imports `knap` (tech.md: one small adapter keeps the
 * pre-1.0 dependency contained). It renders templates with Web Clipper's
 * syntax and filters, finds inline prompt variables, and produces the
 * template editor's diagnostics.
 */

/** True for values a template would show as nothing. */
function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null || value === '') return true;
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/**
 * `{{value|default:"fallback"}}` (7.0.2). knap has no `default` filter (its
 * equivalent is the `??` operator), so the plugin provides one.
 */
const defaultFilter: TemplateFilter = (value, param, context) => {
	const original = context?.rawValue ?? value;
	if (!isEmptyValue(original)) return original;
	const fallback = context?.rawArguments?.[0];
	if (fallback !== undefined) return fallback;
	return (param ?? '').replace(/^"([\s\S]*)"$/u, '$1');
};
defaultFilter.metadata = {
	example: 'default:"n/a"',
	validateParams: (param) =>
		param === undefined || param === '' ? { valid: false, error: 'default needs a fallback value, like default:"n/a"' } : { valid: true },
};

/** Web Clipper's filters, as knap implements them, plus `default`. */
const FILTERS: Readonly<FilterRegistry> = { ...standardFilters, default: defaultFilter };

/** Used for parsing and editor diagnostics, with knap's own argument checks. */
const diagnosticsEngine = createEngine({ filters: FILTERS });

/** Ends a message with exactly one sentence-ending mark. */
function sentence(message: string): string {
	return /[.?!]$/u.test(message) ? message : `${message}.`;
}

/**
 * Wraps every filter so a filter that can't run leaves its value unfiltered
 * and is named in a notice (7.0.3), instead of blanking the value as knap
 * does for invalid arguments. The wrappers carry no metadata on purpose, so
 * knap doesn't reject the call first; each wrapper runs the filter's own
 * argument check itself.
 */
function guardedFilters(notices: Set<string>): FilterRegistry {
	const guarded: FilterRegistry = {};
	for (const [name, filter] of Object.entries(FILTERS)) {
		const report = (why = "couldn't be applied") =>
			notices.add(`The "${name}" filter ${why}, so the value was left unfiltered.`);
		guarded[name] = (value, param, context) => {
			const unfiltered = context?.rawValue ?? value;
			const check = filter.metadata?.validateParams?.(param);
			if (check && !check.valid) {
				report(`has invalid settings (${check.error ?? 'check its arguments'})`);
				return unfiltered;
			}
			try {
				const result = filter(value, param, context);
				if (result instanceof Promise) {
					return result.catch(() => {
						report();
						return unfiltered;
					});
				}
				return result;
			} catch {
				report();
				return unfiltered;
			}
		};
	}
	return guarded;
}

/**
 * An inline prompt variable (21.0.1): `{{"prompt text"}}`, optionally with
 * filters, as in Web Clipper's Interpreter. Web Clipper's legacy
 * `{{prompt:"…"}}` form is accepted too. Escaped quotes (`\"`) may appear
 * inside the prompt.
 */
const PROMPT_VARIABLE = /\{\{\s*(?:prompt:)?"((?:[^"\\]|\\[\s\S])*)"\s*((?:\|[\s\S]*?)?)\s*\}\}/gu;

/** One inline prompt variable found in a template. */
export interface PromptOccurrence {
	/** The prompt text, with escapes resolved. */
	text: string;
	/** Offset of the opening `{{` in the template. */
	index: number;
	length: number;
	/** The filter chain including its leading `|`, or empty. */
	filters: string;
}

/** Finds every inline prompt variable in a template, in order. */
export function findPrompts(template: string): PromptOccurrence[] {
	return [...template.matchAll(PROMPT_VARIABLE)].map((match) => ({
		text: (match[1] ?? '').replace(/\\([\s\S])/gu, '$1'),
		index: match.index,
		length: match[0].length,
		filters: (match[2] ?? '').trim(),
	}));
}

/**
 * The distinct prompt texts across a set of templates, in order of first
 * appearance. Identical prompts share one answer (design decision 8).
 */
export function collectPrompts(templates: string[]): string[] {
	const seen = new Set<string>();
	for (const template of templates) {
		for (const prompt of findPrompts(template)) seen.add(prompt.text);
	}
	return [...seen];
}

/** The variable a prompt's answer is passed in as, chosen so it can't clash with a real one. */
function promptVariableName(index: number): string {
	return `__inference_machine_prompt_${index + 1}`;
}

/** The result of rendering one template field. */
export interface RenderResult {
	text: string;
	/** Problems the user should hear about, such as a filter that couldn't be applied (7.0.3). */
	notices: string[];
}

/**
 * Renders a template with the run's variables.
 *
 * With `prompts` (prompt text → answer), each inline prompt variable is
 * replaced by its answer, and its own filters apply to the answer (21.0.4).
 * A prompt without an answer renders empty (21.0.6). Without `prompts`, as
 * for the main prompt and prompt context, an inline prompt variable renders
 * as its plain text (21.0.7).
 */
export async function render(
	template: string,
	variables: Record<string, unknown>,
	prompts?: ReadonlyMap<string, string>,
): Promise<RenderResult> {
	const notices = new Set<string>();
	let source = template;
	const allVariables = { ...variables };
	if (prompts) {
		const order = [...new Set(findPrompts(template).map((p) => p.text))];
		order.forEach((text, i) => {
			allVariables[promptVariableName(i)] = prompts.get(text) ?? '';
		});
		source = template.replace(PROMPT_VARIABLE, (_match, rawText: string, filters: string) => {
			const text = rawText.replace(/\\([\s\S])/gu, '$1');
			return `{{${promptVariableName(order.indexOf(text))}${filters.trim()}}}`;
		});
	}

	const engine = createEngine({ filters: guardedFilters(notices) });
	const result = await engine.render(source, { variables: allVariables });
	for (const error of result.errors) {
		if (error.code === 'PARSE_ERROR') {
			notices.add(`A template has a syntax error (line ${error.line}: ${error.message}), so it was used as written.`);
			return { text: template, notices: [...notices] };
		}
		notices.add(`${sentence(error.message)} The value was left unfiltered.`);
	}
	for (const warning of result.warnings) notices.add(`The "${warning.filter}" filter: ${sentence(warning.message)}`);
	return { text: result.output, notices: [...notices] };
}

/** A problem shown in the template editor (6.0.4, 7.0.3, 21.0.7). Lines and columns start at 1. */
export interface Diagnostic {
	message: string;
	line: number;
	column: number;
	severity: 'error' | 'warning';
}

/** Converts an offset in `text` to a 1-based line and column. */
function position(text: string, offset: number): { line: number; column: number } {
	const before = text.slice(0, offset).split('\n');
	return { line: before.length, column: (before[before.length - 1]?.length ?? 0) + 1 };
}

/** Calls `visit` with the root name of every variable a template reads, skipping loop and `set` variables. */
function walkVariables(ast: ASTNode[], visit: (name: string, line: number, column: number) => void): void {
	const walkExpression = (expression: Expression, scope: ReadonlySet<string>): void => {
		switch (expression.type) {
			case 'identifier': {
				const root = expression.path?.[0] ?? expression.name.split('.')[0] ?? expression.name;
				if (!scope.has(root)) visit(root, expression.line, expression.column);
				return;
			}
			case 'member':
				walkExpression(expression.object, scope);
				if (expression.computed) walkExpression(expression.property, scope);
				return;
			case 'filter':
				walkExpression(expression.value, scope);
				for (const arg of expression.args) walkExpression(arg, scope);
				return;
			case 'binary':
				walkExpression(expression.left, scope);
				walkExpression(expression.right, scope);
				return;
			case 'unary':
				walkExpression(expression.argument, scope);
				return;
			case 'group':
				walkExpression(expression.expression, scope);
				return;
			case 'literal':
				return;
		}
	};
	const walkNodes = (nodes: ASTNode[], outer: ReadonlySet<string>): void => {
		// `{% set %}` makes a name available to the nodes after it.
		const scope = new Set(outer);
		for (const node of nodes) {
			switch (node.type) {
				case 'variable':
					walkExpression(node.expression, scope);
					break;
				case 'if':
					walkExpression(node.condition, scope);
					walkNodes(node.consequent, scope);
					for (const branch of node.elseifs) {
						walkExpression(branch.condition, scope);
						walkNodes(branch.body, scope);
					}
					if (node.alternate) walkNodes(node.alternate, scope);
					break;
				case 'for':
					walkExpression(node.iterable, scope);
					walkNodes(node.body, new Set([...scope, node.iterator]));
					break;
				case 'set':
					walkExpression(node.value, scope);
					scope.add(node.variable);
					break;
				case 'text':
					break;
			}
		}
	};
	walkNodes(ast, new Set());
}

/** The root names of every variable a template reads, such as `content` or `properties`. */
export function referencedVariables(template: string): Set<string> {
	const names = new Set<string>();
	walkVariables(diagnosticsEngine.parse(template).ast, (name) => names.add(name));
	return names;
}

/**
 * Checks a template field for the template editor:
 *
 * - syntax errors, and unknown filters or invalid filter arguments (7.0.3)
 * - variable names the plugin doesn't provide (6.0.4); knap's own variable
 *   check only knows Web Clipper's page variables (design decision 9)
 * - inline prompt variables in the main prompt or prompt context, where they
 *   can't be answered (21.0.7)
 */
export function diagnose(template: string, field: TemplateField): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	if (field !== 'output') {
		for (const prompt of findPrompts(template)) {
			diagnostics.push({
				...position(template, prompt.index),
				severity: 'error',
				message:
					field === 'prompt'
						? 'Inline prompts can\'t be used in the main prompt. Write the instruction directly instead.'
						: 'Inline prompts can\'t be used in the prompt context.',
			});
		}
	}

	const seen = new Set<string>();
	for (const error of diagnosticsEngine.validate(template)) {
		const key = `${error.line}:${error.column}:${error.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		diagnostics.push({ message: error.message, line: error.line, column: error.column, severity: 'error' });
	}

	const known = knownVariables(field);
	walkVariables(diagnosticsEngine.parse(template).ast, (name, line, column) => {
		if (known.has(name)) return;
		const message =
			name === 'output'
				? '{{output}} is only available in the filename, properties and body wrapper.'
				: `Unknown variable "${name}". It will be empty when the template runs.`;
		diagnostics.push({ message, line, column, severity: 'warning' });
	});
	return diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
}
