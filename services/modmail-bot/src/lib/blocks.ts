import { getContext } from '@chatsift/backend-core';
import type { Blocks } from '@chatsift/db';

/**
 * Checked by `createTicket.ts` (fast pre-check, before the category picker is even shown) and, for a
 * categorized panel, re-checked authoritatively by `categorySelect.ts` immediately before a private
 * thread is actually created — the dashboard-managed `blocks` table (see
 * `services/api/src/routes/modmail/blocks`) is the only way a block gets created or removed, this is
 * purely an enforcement read. A non-expiring block has `expires_at IS NULL`.
 */
export async function findActiveBlock(guildId: string, userId: string): Promise<Blocks | undefined> {
	const [block] = await getContext().db<Blocks[]>`
		SELECT * FROM blocks
		WHERE guild_id = ${guildId} AND user_id = ${userId} AND (expires_at IS NULL OR expires_at > now())
	`;

	return block;
}
