/**
 * Checks for the "next to the source note, in a specified folder" output
 * location (Q58). Kept free of Obsidian imports so loading, the UI and the
 * note writer can share one rule, and so it can be unit-tested.
 */

/** A relative folder path split into its parts, or why it can't be used. */
export type SubfolderCheck = { segments: string[] } | { error: string };

/**
 * Splits a folder path that is relative to the source note's folder.
 *
 * Both `/` and `\` separate parts, since people on Windows type either.
 * Empty parts and `.` are dropped, so a leading or trailing slash and `./`
 * change nothing. An empty path gives no parts, which means the source
 * note's own folder (Q59). A `..` part is refused rather than resolved: the
 * choice promises a folder *inside* the source's folder, so it must not
 * reach anywhere else in the vault.
 */
export function subfolderSegments(path: string): SubfolderCheck {
	const segments = path
		.split(/[/\\]/u)
		.map((segment) => segment.trim())
		.filter((segment) => segment !== '' && segment !== '.');
	if (segments.includes('..')) return { error: `The folder "${path.trim()}" leads out of the source note's folder.` };
	return { segments };
}
