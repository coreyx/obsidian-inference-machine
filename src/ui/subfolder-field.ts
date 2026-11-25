import type { Setting } from 'obsidian';
import { subfolderSegments } from '../core/location';

/** The placeholder every "folder inside the source note's folder" field shows. */
export const SUBFOLDER_PLACEHOLDER = 'Folder inside the source note\'s folder';

/** The dropdown label for the `subfolder` output location, in the user's own words. */
export const SUBFOLDER_LABEL = 'Next to the source note, in a specified folder';

/** How a subfolder field reports what was typed. */
export interface SubfolderFieldOptions {
	/** The path to show at first. */
	value: string;
	/** The description to show for a usable path, given its parts; empty parts mean the source note's own folder. */
	describe: (segments: string[]) => string;
	/** Called on every edit, with whether the path can be used. */
	onChange: (path: string, valid: boolean) => void;
}

/**
 * Adds a plain text field for a folder relative to the source note's folder
 * (Q58) to a setting row. The vault folder picker isn't used, because the
 * folder it names depends on each source note.
 *
 * The row's description updates as the user types: the caller's description
 * for a usable path, or the reason it can't be used. Updating the row in
 * place, rather than re-rendering, keeps the cursor in the field.
 */
export function addSubfolderField(setting: Setting, options: SubfolderFieldOptions): void {
	const show = (path: string): boolean => {
		const check = subfolderSegments(path);
		const valid = !('error' in check);
		setting.setDesc(valid ? options.describe(check.segments) : check.error);
		setting.settingEl.toggleClass('im-invalid', !valid);
		return valid;
	};
	setting.addText((text) => {
		text.setPlaceholder(SUBFOLDER_PLACEHOLDER).setValue(options.value);
		text.onChange((path) => options.onChange(path, show(path)));
	});
	show(options.value);
}
