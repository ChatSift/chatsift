export interface AppealTarget {
	kind: 'guild' | 'invite';
	value: string;
}

/**
 * Pulls a guild id or an invite code out of whatever the appellant pasted into the landing page -- a bare code,
 * a `discord.gg` link, a `discord.com/invite` link, or an `unban.app` link somebody sent them. `null` for
 * anything that is not one of those shapes.
 *
 * Presentation, not authorization: whatever comes out of here is handed to `/g/<id>` or `/<code>`, and both
 * re-establish everything that matters server-side. Being wrong here costs a 404 page, never access.
 *
 * A snowflake is matched first and exactly, because an id and an invite code are not otherwise distinguishable
 * -- `123456789012345678` is a syntactically valid vanity code, and the guild reading is overwhelmingly more
 * likely to be what somebody pasting eighteen digits meant.
 */
export function parseTarget(input: string): AppealTarget | null {
	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}

	if (/^\d{17,20}$/.test(trimmed)) {
		return { kind: 'guild', value: trimmed };
	}

	// The last non-empty *path* segment of anything URL-shaped, which is the invite code for every link form
	// above. A bare code has no separators and falls through this unchanged.
	//
	// The query and fragment are cut before the path is split, not alongside it: an invite copied out of Discord
	// often carries one (`?event=...`), and splitting on `?` as if it were a path separator makes `event=...`
	// the last segment, which then fails the code check and reads as junk.
	const path = trimmed.replace(/^https?:\/\//, '').split(/[#?]/)[0] ?? '';
	const code = path.replace(/\/+$/, '').split('/').pop();
	if (!code || !/^[\w-]{1,64}$/.test(code)) {
		return null;
	}

	return { kind: 'invite', value: code };
}
