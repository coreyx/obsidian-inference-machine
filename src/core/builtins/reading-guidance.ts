/**
 * The shared "Reading the source note" guidance every built-in template
 * includes (15.0.2, Q2). It does for notes what the YouTube summarizer's
 * transcription-error guidance did for subtitles: it tells the model how to
 * read a source that may be rough, and how to use frontmatter as context
 * without inventing anything.
 */
export const READING_GUIDANCE = `## Reading the source note

The source note may be rough: shorthand, fragments, lists or dictated text.

- Use the frontmatter (the YAML block at the top, if there is one) as context, such as the note's author, date or status. Don't summarize it.
- Expand obvious shorthand and fix obvious typos.
- Write a fragment out as a full statement only when its meaning is clear. Otherwise, keep it close to how the note puts it.
- Add no facts, names or numbers that aren't in the note. Where the note is ambiguous, say so rather than guessing.
- Keep existing [[wikilinks]] as they are, and keep the note's own spelling of names and terms.`;

/** The closing instruction every built-in uses, so the output can be saved as it comes back. */
export const OUTPUT_RULES = 'Respond with the Markdown for the new note only: no introduction or closing remarks, and don\'t wrap it in a code block.';
