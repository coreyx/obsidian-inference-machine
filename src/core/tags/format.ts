import type { TagFormat } from '../schema';
import { splitWords, stripHash } from './normalize';

/** Capitalizes the first character of a word and lowercases the rest. */
function capitalize(word: string): string {
	const [first = '', ...rest] = [...word.toLowerCase()];
	return first.toUpperCase() + rest.join('');
}

/** Converts one `/`-free segment of a tag to a named format. */
function formatSegment(segment: string, format: Exclude<TagFormat, { custom: string }>): string {
	const words = splitWords(segment).map((word) => word.toLowerCase());
	switch (format) {
		case 'kebab':
			return words.join('-');
		case 'snake':
			return words.join('_');
		case 'camel':
			return words.map((word, i) => (i === 0 ? word : capitalize(word))).join('');
		case 'pascal':
			return words.map(capitalize).join('');
	}
}

/**
 * Converts a tag to a named format, segment by segment so nesting is kept
 * (13.0.3): `ai/machine learning` in camelCase is `ai/machineLearning`.
 * A custom format is described to the model in words and can't be applied
 * mechanically, so the tag is returned as it is (without a leading `#`).
 */
export function formatTag(tag: string, format: TagFormat): string {
	const bare = stripHash(tag);
	if (typeof format === 'object') return bare;
	return bare
		.split('/')
		.map((segment) => formatSegment(segment, format))
		.join('/');
}
