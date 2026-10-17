import type { PropertyDef, Template } from '../schema';
import { OUTPUT_RULES, READING_GUIDANCE } from './reading-guidance';

/**
 * The built-in templates (REQ-15). Each relies only on the built-in safe
 * defaults for anything it doesn't set (15.0.5), adds a `created` date
 * (15.0.7), and leaves out properties that render empty (15.0.8).
 *
 * Bump a built-in's `version` whenever its content changes: on load, copies
 * the user hasn't edited are upgraded to the new version (15.0.4).
 */

/** A built-in's definition: its content, without the per-install `id` and `origin`. */
export interface BuiltInTemplate {
	builtInId: string;
	version: number;
	template: Omit<Template, 'id' | 'origin'>;
}

const CREATED: PropertyDef = { name: 'created', value: '{{date}}', type: 'date' };

/** Fences an example inside a prompt without ending the prompt's own Markdown. */
const FENCE = '```';

const COMPREHENSIVE_SUMMARY = `You are a specialized assistant for creating comprehensive summaries of notes.

## Task

Create a concise yet comprehensive summary of the source note below.

${READING_GUIDANCE}

## Extracting actionable insights

For the "Actionable insights" section, extract practical advice, workflows, implementation details, best practices, recommendations, lessons learned, warnings, optimization opportunities and concrete takeaways from the note. Return a Markdown bullet list. Focus on information a reader could apply in their own work or projects. If the note is primarily informational rather than instructional, identify the most useful insights and explain how they might be applied.

## Output structure

${FENCE}
## Summary
[Write a comprehensive summary of the main topic and key message]

## Key points
- [Key point 1]
- [Key point 2]
- [Additional key points...]

## Technical terms
- **[[Term 1]]**: [Explanation of term 1]
- **[[Term 2]]**: [Explanation of term 2]
- [Additional terms as needed...]

## Actionable insights
- [Actionable insight 1]
- [Actionable insight 2]
- [Additional insights...]

## Conclusion
[Write a brief conclusion]
${FENCE}

Note: Include all sections. If there are no technical terms, omit that section entirely.

${OUTPUT_RULES}`;

const KEY_POINTS = `Write a short version of the source note below.

## Output structure

${FENCE}
**TL;DR:** [One or two sentences with the note's main message]

## Key points
- [Most important point]
- [Next point]
- [Additional points...]
${FENCE}

Keep each key point to one line where you can, and put the most important first.

${READING_GUIDANCE}

${OUTPUT_RULES}`;

const ACTION_ITEMS = `Pull the tasks, decisions and follow-ups out of the source note below.

## Output structure

${FENCE}
## Action items
- [ ] [Task or follow-up] (owner: [name]) (due: [date])

## Decisions
- [Decision]

## Open questions
- [Question the note leaves open]
${FENCE}

- Write every task and follow-up as an Obsidian checklist item, starting with "- [ ]".
- Add "(owner: …)" only when the note says who owns the item, and "(due: …)" only when it says when it's due. Write a due date as YYYY-MM-DD when the exact date is clear, and as the note puts it otherwise.
- Leave out the Decisions or Open questions section when the note has none. If the note has no tasks, write "- No action items in this note." under Action items.

${READING_GUIDANCE}

${OUTPUT_RULES}`;

const FLASHCARDS = `Turn the source note below into flashcards for spaced-repetition study.

- Write one card per line, as "Question::Answer", with nothing else on the line.
- Each card tests one fact or idea from the note. Make every question make sense on its own, without the note.
- Keep answers short. Don't use "::" anywhere else in a card.
- Cover the note's important ideas: write as many cards as the note supports, usually between 5 and 20.

${READING_GUIDANCE}

Respond with the cards only, one per line: no headings, numbering, introduction or code block.`;

const LITERATURE_NOTE = `Write a literature note about the work the source note covers, such as an article, book, paper or talk.

## Output structure

${FENCE}
## Source
[What the work is, who made it and what it's about, in two or three sentences]

## Main arguments
- [Argument or idea the work puts forward]
- [Additional arguments...]

## Key quotes and evidence
> [A quote, exactly as the note gives it]

- [Evidence, data or examples the work uses]

## Takeaways
- [The note-taker's own reactions, opinions and ideas, in their own voice]
${FENCE}

- Leave out the "Key quotes and evidence" section when the note has no quotes or evidence, and "Takeaways" when the note records no reactions of its own.
- Never invent a quote: use only quotes that appear in the note.

${READING_GUIDANCE}

${OUTPUT_RULES}`;

/** Every built-in template, in the order they're listed. */
export const BUILT_INS: readonly BuiltInTemplate[] = [
	{
		builtInId: 'comprehensive-summary',
		version: 1,
		template: { name: 'Comprehensive summary', prompt: COMPREHENSIVE_SUMMARY, properties: [CREATED], omitEmptyProperties: true },
	},
	{
		builtInId: 'key-points',
		version: 1,
		template: {
			name: 'Key points / TL;DR',
			prompt: KEY_POINTS,
			// The template name has a slash, which can't go in a filename.
			noteNameFormat: '{{title}} - Key points',
			properties: [CREATED],
			omitEmptyProperties: true,
		},
	},
	{
		builtInId: 'action-items',
		version: 1,
		template: { name: 'Action items', prompt: ACTION_ITEMS, properties: [CREATED], omitEmptyProperties: true },
	},
	{
		builtInId: 'flashcards',
		version: 1,
		template: {
			name: 'Flashcards',
			prompt: FLASHCARDS,
			// The Spaced Repetition plugin finds cards in notes tagged #flashcards (Q12).
			properties: [{ name: 'tags', value: 'flashcards', type: 'multitext' }, CREATED],
			omitEmptyProperties: true,
		},
	},
	{
		builtInId: 'literature-note',
		version: 1,
		template: {
			name: 'Literature note',
			prompt: LITERATURE_NOTE,
			// Carried over from Web Clipper clippings, typed the way Web Clipper types them (15.0.6).
			properties: [
				{ name: 'source', value: '{{properties.source}}', type: 'text' },
				{ name: 'author', value: '{{properties.author}}', type: 'multitext' },
				{ name: 'published', value: '{{properties.published}}', type: 'date' },
				CREATED,
			],
			omitEmptyProperties: true,
		},
	},
];
