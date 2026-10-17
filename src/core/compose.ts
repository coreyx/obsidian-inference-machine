import type { NoteSnapshot } from './note';
import { assembleNote, prepareOutput, typeProperties, type ParseYaml, type RenderedProperty, type StringifyYaml } from './output';
import type { RunConfig } from './resolve';
import { buildTags, type DroppedTag } from './tags/pipeline';
import { render } from './template/knap';
import { buildVariables } from './template/variables';

/**
 * Builds the output note from a run's answers (design.md, "A run, end to
 * end"): renders the filename, properties and body wrapper, runs the tag
 * pipeline, and assembles the final text. It's split in two because the
 * source link depends on the output path, which depends on the filename:
 * `composeNote` renders everything, and the result's `assemble` adds the link.
 */

/** Everything a run produced that goes into the note. */
export interface ComposeInput {
	config: RunConfig;
	note: NoteSnapshot;
	/** The run's start time, for `{{date}}` and `{{time}}`. */
	now: Date;
	/** The main AI output as it came back; undefined when the template has no main prompt (21.0.5). */
	mainOutput?: string;
	/** Inline prompt answers, by prompt text. */
	answers: ReadonlyMap<string, string>;
	/** Tags from the AI tagging request. */
	aiTags: string[];
	/** The vault's tags, most used first; empty unless AI tagging asked for them. */
	vaultTags: readonly string[];
	yaml: { parse: ParseYaml; stringify: StringifyYaml };
}

/** The rendered note, waiting for its source link. */
export interface ComposedNote {
	/** The rendered filename pattern, before sanitizing and collision numbering. */
	fileName: string;
	/** Problems to show in the preview's warnings, such as a filter that couldn't run. */
	notices: string[];
	/** Tags the pipeline dropped, for the preview's warnings (13.0.5). */
	dropped: DroppedTag[];
	/** The final note text, with the source link under the references heading when given. */
	assemble(link?: string): string;
}

/** Renders a run's output note. */
export async function composeNote(input: ComposeInput): Promise<ComposedNote> {
	const { config, note } = input;
	const notices = new Set<string>();
	const prepared = input.mainOutput === undefined ? { body: '', properties: {}, tags: [] } : prepareOutput(input.mainOutput, input.yaml.parse);
	const variables = buildVariables(note, { templateName: config.template.name, now: input.now, output: prepared.body });

	const renderField = async (template: string): Promise<string> => {
		const result = await render(template, variables, input.answers);
		for (const notice of result.notices) notices.add(notice);
		return result.text;
	};

	const fileName = await renderField(config.noteNameFormat);
	const rendered: RenderedProperty[] = [];
	for (const property of config.template.properties ?? []) {
		rendered.push({ name: property.name, type: property.type, value: await renderField(property.value) });
	}
	const body = (await renderField(config.noteContentFormat)).trim();

	const { properties, templateTags } = typeProperties(rendered);
	const tags = buildTags({
		sourceFrontmatter: note.frontmatterTags,
		sourceInline: note.inlineTags,
		template: templateTags,
		// Tags in the output's own frontmatter count as AI tags (8.0.7, Q18).
		ai: [...prepared.tags, ...input.aiTags],
		vaultTags: input.vaultTags,
		settings: config.tagging,
	});

	return {
		fileName,
		notices: [...notices],
		dropped: tags.dropped,
		assemble: (link) =>
			assembleNote({
				body,
				properties,
				aiProperties: prepared.properties,
				tags: tags.tags,
				...(config.references.enabled && link !== undefined ? { references: { heading: config.references.heading, link } } : {}),
				omitEmptyProperties: config.omitEmptyProperties,
				stringifyYaml: input.yaml.stringify,
			}),
	};
}
