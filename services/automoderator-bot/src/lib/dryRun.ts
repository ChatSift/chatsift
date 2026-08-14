import { ENV, getContext } from '@chatsift/backend-core';
import type { AutomoderatorGuildSettings } from '@chatsift/db';

/**
 * Resolves dry-run for one guild: precedence guild then invocation, and **only outside production**
 * (docs/roadmap/11-automoderator-port.md).
 *
 * There is deliberately no env-var layer. Dry-run is a development affordance -- a way to watch what the bot
 * would do without letting it do it -- not an operational mode production is ever meant to sit in. A
 * deployment-wide switch would only ever read one way in production, which makes it a switch that lies, and
 * "why did nothing happen" traced back to a stale env var is a worse failure than not having the knob.
 *
 * The production short-circuit comes first, before any query: it is the invariant, not a default that
 * something further down could override.
 *
 * `invocationOverride` is the innermost layer -- a command explicitly asking to preview what it would do. It
 * can only ever turn dry-run *on*, so nothing reachable from inside an interaction can escape the guild's
 * setting.
 */
export async function resolveDryRun(guildId: string, invocationOverride?: boolean): Promise<boolean> {
	if (ENV.IS_PRODUCTION) {
		return false;
	}

	if (invocationOverride === true) {
		return true;
	}

	const [settings] = await getContext().db<Pick<AutomoderatorGuildSettings, 'dryRun'>[]>`
		SELECT dry_run FROM automoderator_guild_settings WHERE guild_id = ${guildId}
	`;

	// A guild with no row is a guild nobody has configured, which is exactly when the safe reading matters
	// most -- so it matches the column's own default rather than falling through to "act for real".
	return settings?.dryRun ?? true;
}
