import { RedisStore } from '@chatsift/backend-core';
import { createRecipe, DataType } from 'bin-rw';

export interface CategorySelectStateAttachment {
	contentType: string;
	filename: string;
	size: number;
	url: string;
}

export interface CategorySelectStateSticker {
	formatType: number;
	id: string;
	name: string;
}

export interface CategorySelectState {
	attachments: CategorySelectStateAttachment[];
	categoryIds: number[];
	content: string;
	/**
	 * Whether the first message was a Discord "Forward" — see `lib/messageContext.ts`.
	 */
	isForwarded: boolean;
	/**
	 * Whether the first message was a Discord-native reply (to something other than a forward).
	 */
	isReply: boolean;
	messageId: string;
	stickers: CategorySelectStateSticker[];
}

/**
 * Bridges the gap between a user's first message in their private thread (caught by `index.ts`'s
 * `MessageCreate` handler) and the `modmail-category-select` pick that follows it: the panel's
 * allowed category ids plus the captured first message (including any attachments/stickers, so
 * `lib/media.ts` can still forward them) don't fit in a `custom_id` on their own, so they're stashed
 * here keyed by a short-lived nanoid embedded in the select's `custom_id` instead. `categorySelect.ts`
 * relays the stored message into the mod thread once a category is picked, so both the category and
 * the user's first message land with staff together. `contentType` defaults to `''` when Discord
 * didn't report one (the recipe's `DataType.String` isn't nullable) — treated as "unknown" on read.
 */
export const CategorySelectStore = new RedisStore<CategorySelectState>({
	TTL: 10 * 60 * 1_000,
	recipe: createRecipe({
		categoryIds: [DataType.I32],
		messageId: DataType.String,
		content: DataType.String,
		attachments: [
			{
				url: DataType.String,
				filename: DataType.String,
				contentType: DataType.String,
				size: DataType.I32,
			},
		],
		stickers: [
			{
				id: DataType.String,
				name: DataType.String,
				formatType: DataType.I32,
			},
		],
		isForwarded: DataType.Bool,
		isReply: DataType.Bool,
	}),
	makeKey: (id: string) => `modmail:category-select:${id}`,
	storeOld: false,
});
