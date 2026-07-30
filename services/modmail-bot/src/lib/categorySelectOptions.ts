import type { Categories } from '@chatsift/db';
import type { APIMessageComponentEmoji, APISelectMenuOption } from '@discordjs/core';

// Matches Discord's own shorthand for a custom guild emoji (`<:name:id>`, `<a:name:id>` for animated) --
// the same shape the dashboard's `EmojiInput.tsx` writes into `Category.emoji` when a custom emoji is
// picked (see `apps/website`'s `Emoji.tsx` for the identical pattern used to render it back). A select
// option's `emoji` field needs `{ id, name }` for a custom emoji (Discord renders it from the id, the
// name is just accessibility metadata) versus `{ name }` alone for a plain unicode emoji -- passing the
// raw `<:name:id>` string through as `name` renders literal angle-bracket text instead of the emoji.
const CUSTOM_EMOJI_REGEX = /^<(?<animated>a)?:(?<name>\w{2,32}):(?<id>\d{17,20})>$/;

function categoryOptionEmoji(emoji: string): APIMessageComponentEmoji {
	const match = CUSTOM_EMOJI_REGEX.exec(emoji);
	if (!match?.groups) {
		return { name: emoji };
	}

	// `name` and `id` are always captured when the regex matches at all -- only `animated` is an
	// optional group -- so the non-null assertions just narrow past `groups`' blanket
	// `string | undefined` index-signature typing, they're not asserting past anything actually unknown.
	return {
		id: match.groups['id']!,
		name: match.groups['name']!,
		...(match.groups['animated'] ? { animated: true } : {}),
	};
}

/**
 * Shared by every place a category list is rendered as a string-select's options -- `components/createTicket.ts`
 * (panel flow, panel-scoped categories) and `lib/dmTicket.ts`/`components/dmCategorySelect.ts` (DM mode,
 * #216 P4, all of a guild's categories).
 */
export function buildCategorySelectOptions(categories: Categories[]): APISelectMenuOption[] {
	return categories.map((category) => ({
		label: category.name.slice(0, 100),
		value: String(category.id),
		...(category.description ? { description: category.description.slice(0, 100) } : {}),
		...(category.emoji ? { emoji: categoryOptionEmoji(category.emoji) } : {}),
	}));
}
