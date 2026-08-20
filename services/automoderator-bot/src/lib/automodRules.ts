import { getContext } from '@chatsift/backend-core';
import type { APIAutoModerationRule } from '@discordjs/core';

/**
 * A guild's native AutoMod rule names, for the filter log's benefit only (P5, feature 33).
 *
 * Nothing in the *decision* path needs this: `AUTO_MODERATION_ACTION_EXECUTION` carries `rule_id`, and
 * policies are keyed on it, so a banword hit resolves without ever asking Discord anything. This exists purely
 * so the log embed can say "Slurs" instead of a snowflake.
 *
 * **Best-effort by construction.** Reading AutoMod rules requires Manage Server, which this bot does not
 * necessarily hold -- receiving the execution event does not require it. A guild where the lookup 403s gets log
 * embeds naming the rule by id, which is worse than a name and far better than no log at all, so every failure
 * here degrades rather than propagating.
 *
 * Process-local rather than redis, unlike the message and member caches: this is a display nicety measured in a
 * few hundred bytes per guild, it is regenerated on any miss, and a stale name for a minute is invisible. The
 * caches that live in redis are the ones whose loss is a lost feature.
 */
interface CachedRuleNames {
	readonly expiresAt: number;
	readonly names: Map<string, string>;
}

const RULE_NAME_TTL_MS = 5 * 60 * 1_000;

const cache = new Map<string, CachedRuleNames>();

/**
 * Exported for tests, and for a future `/simulate` that wants to force a fresh read.
 */
export function clearAutomodRuleCache(): void {
	cache.clear();
}

export async function resolveAutomodRuleName(guildId: string, ruleId: string): Promise<string | null> {
	const cached = cache.get(guildId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.names.get(ruleId) ?? null;
	}

	const context = getContext();

	let rules: APIAutoModerationRule[];
	try {
		rules = await context.service.client.api.guilds.getAutoModerationRules(guildId);
	} catch (error) {
		// Cached as an empty map on failure, deliberately: a guild where the bot lacks Manage Server would
		// otherwise issue this request on every single filter hit, forever, to be told no every time.
		cache.set(guildId, { names: new Map(), expiresAt: Date.now() + RULE_NAME_TTL_MS });
		context.logger.debug({ err: error, guildId }, 'could not read AutoMod rule names');
		return null;
	}

	const names = new Map(rules.map((rule) => [rule.id, rule.name]));
	cache.set(guildId, { names, expiresAt: Date.now() + RULE_NAME_TTL_MS });

	return names.get(ruleId) ?? null;
}
