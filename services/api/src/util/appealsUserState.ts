import { encrypt, getContext } from '@chatsift/backend-core';
import type { AppealUserState } from '@chatsift/db';
import type { Snowflake } from '@discordjs/core';

/**
 * Records what a completed `unban.app` login gives us about the appellant that has to outlive their session
 * (#232 §6, decision 14).
 *
 * The refresh token is the point of this table. Approving an appeal can re-add the appellant to the guild, and
 * that happens days or weeks after they authorized -- long after the browser session that produced it is gone,
 * and long after the access token from that exchange expired. It is stored encrypted with the same
 * `encrypt`/`decrypt` #216 uses for instance bot tokens, and it is **never** exposed to a guild's moderators:
 * no mod-facing route reads this table, and the mod-side embed learns only whether delivery looks likely.
 *
 * `granted_guilds_join` is read off the scopes Discord actually returned rather than the ones we asked for, so
 * an appellant who trims the scope on the consent screen is recorded as having declined rather than as having
 * agreed -- which is the difference between an approval that DMs an invite (correct) and one that tries to add
 * them and fails (a decision that silently half-lands).
 *
 * `dm_reachable` is deliberately left alone here. It means "a DM has actually been delivered", which a login
 * cannot establish -- P6 writes it when it first tries.
 */
export async function recordAppellantGrant(
	userId: Snowflake,
	grant: { grantedGuildsJoin: boolean; refreshToken: string },
): Promise<void> {
	await getContext().db`
		INSERT INTO appeal_user_state (user_id, granted_guilds_join, refresh_token)
		VALUES (${userId}, ${grant.grantedGuildsJoin}, ${encrypt(grant.refreshToken)})
		ON CONFLICT (user_id) DO UPDATE SET
			granted_guilds_join = EXCLUDED.granted_guilds_join,
			refresh_token = EXCLUDED.refresh_token,
			updated_at = now()
	`;
}

export async function readAppealUserState(userId: Snowflake): Promise<AppealUserState | null> {
	const [row] = await getContext().db<AppealUserState[]>`
		SELECT * FROM appeal_user_state WHERE user_id = ${userId}
	`;

	return row ?? null;
}
