import { RedisStore } from '@chatsift/backend-core';
import { createRecipe, DataType } from 'bin-rw';

export interface PendingTicketState {
	categoryIds: number[];
	guildId: string;
	userId: string;
}

/**
 * A private thread exists but isn't a ticket yet — the user is expected to describe their issue
 * before anything is sent to staff. Keyed by the private thread's channel id, this bridges
 * `createTicket.ts` (which only knows the panel's allowed categories at button-click time) to the
 * `MessageCreate` handler in `index.ts` that catches the user's first message and either finishes
 * the ticket outright (no categories configured) or prompts for a category next.
 */
export const PendingTicketStore = new RedisStore<PendingTicketState>({
	TTL: 30 * 60 * 1_000,
	recipe: createRecipe({
		categoryIds: [DataType.I32],
		guildId: DataType.String,
		userId: DataType.String,
	}),
	makeKey: (channelId: string) => `modmail:pending-ticket:${channelId}`,
	storeOld: false,
});
