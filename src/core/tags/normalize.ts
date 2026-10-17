/**
 * Tag equivalence (design decision 7, 12.0.2). Two tags are the same tag when
 * they have the same key, or when they match ignoring case, which is how
 * Obsidian itself compares tags. Every dedup and vault-matching rule in the
 * pipeline goes through these two functions, so they behave the same everywhere.
 */

/** Removes leading `#` characters: `#Project` and `Project` name the same tag. */
export function stripHash(tag: string): string {
	return tag.replace(/^#+/u, '');
}

/**
 * Splits text into words on `-`, `_`, `/`, whitespace, and case boundaries:
 *
 * - lower-to-upper (`machineLearning` → `machine`, `Learning`)
 * - the end of an acronym (`HTMLParser` → `HTML`, `Parser`)
 * - a digit followed by a capitalized word (`web3Dev` → `web3`, `Dev`)
 *
 * Digits stay attached to their letters, so `y1984` and `3D` are one word each.
 */
export function splitWords(text: string): string[] {
	return text
		.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
		.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
		.replace(/(\p{N})(\p{Lu}\p{Ll})/gu, '$1 $2')
		.split(/[\s/_-]+/u)
		.filter((word) => word !== '');
}

/**
 * The tag's equivalence key: its words, lowercased and joined by single spaces.
 * `ai/machine-learning`, `ai-machine-learning`, `AiMachineLearning` and
 * `ai_machine_learning` all have the key `ai machine learning`.
 */
export function tagKey(tag: string): string {
	return splitWords(stripHash(tag).normalize('NFC'))
		.map((word) => word.toLowerCase())
		.join(' ');
}

/** The tag as Obsidian compares it: without `#`, ignoring case. `DevOps` and `devops` match. */
export function tagFold(tag: string): string {
	return stripHash(tag).normalize('NFC').toLowerCase();
}
