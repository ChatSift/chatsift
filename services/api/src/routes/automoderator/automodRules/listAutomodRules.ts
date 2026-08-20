import { getContext } from '@chatsift/backend-core';
import type { APIAutoModerationRule } from '@discordjs/core';
import { AutoModerationActionType, AutoModerationRuleTriggerType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAutomoderator } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * One of the guild's native AutoMod rules, trimmed to what a policy editor needs.
 *
 * Deliberately not the raw `APIAutoModerationRule`: that carries exempt role/channel lists, the alert channel,
 * the timeout duration and the creator id, none of which this product reads or shows -- and a rule's
 * `keyword_filter` can hold a thousand entries, so the trim is also what keeps the response a sane size.
 */
export interface AutomodRuleSummary {
	/**
	 * Every action type the rule takes, as Discord's own enum values. Kept alongside `blocksMessages` rather
	 * than replaced by it because the dashboard shows the rule's configured behaviour, and "timeout" and
	 * "alert" are different things to tell a moderator about.
	 */
	readonly actionTypes: number[];
	/**
	 * Whether any of the rule's actions suppresses the message. This is what decides whether a REPORT policy
	 * is offerable: a blocked message never existed as far as Discord is concerned, so there is nothing for a
	 * report card to link to (see `automoderator_banword_action` in schema.sql).
	 */
	readonly blocksMessages: boolean;
	readonly enabled: boolean;
	readonly id: string;
	/**
	 * The rule's literal keyword entries, the only ones a keyword-level policy can name. Empty for a regex-only
	 * or preset rule, which is exactly the case a rule-level policy exists for.
	 */
	readonly keywords: string[];
	readonly name: string;
	/**
	 * Discord's built-in word lists (Profanity / Sexual Content / Slurs), as enum values. **These are not
	 * enumerable** -- there is no way to ask Discord which words are in them -- so a rule using them can only
	 * ever carry a rule-level policy.
	 */
	readonly presets: number[];
	readonly regexPatterns: string[];
	readonly triggerType: number;
}

/**
 * Why the rule list is unavailable, when it is. Both are ordinary states a guild can be in rather than errors,
 * and the dashboard renders each differently -- which is the whole reason this route answers with a
 * discriminated result instead of a 4xx.
 *
 * - `missing-permission` -- the bot does not hold Manage Server, which every AutoMod endpoint requires. The
 *   fix is an invite-link permission change, and saying so beats a red toast.
 * - `missing-access` -- the bot is not in the guild (or was just removed). Rare from a dashboard that only
 *   lists guilds it is in, and reachable in the window after a kick.
 */
export type AutomodRulesUnavailableReason = 'missing-access' | 'missing-permission';

export type ListAutomodRulesResult =
	{ available: false; reason: AutomodRulesUnavailableReason } | { available: true; rules: AutomodRuleSummary[] };

const BLOCKING_ACTIONS = new Set<number>([AutoModerationActionType.BlockMessage]);

function summarize(rule: APIAutoModerationRule): AutomodRuleSummary {
	const actionTypes = rule.actions.map((action) => action.type as number);
	// `trigger_metadata` is a union whose members differ per trigger type, and Discord omits the arrays that
	// do not apply rather than sending them empty -- so every read here is defaulted.
	const metadata = rule.trigger_metadata as {
		keyword_filter?: string[];
		presets?: number[];
		regex_patterns?: string[];
	};

	return {
		id: rule.id,
		name: rule.name,
		enabled: rule.enabled,
		triggerType: rule.trigger_type as number,
		actionTypes,
		blocksMessages: actionTypes.some((type) => BLOCKING_ACTIONS.has(type)),
		keywords: metadata.keyword_filter ?? [],
		regexPatterns: metadata.regex_patterns ?? [],
		presets: metadata.presets ?? [],
	};
}

/**
 * Trigger types whose hits can carry a policy. Mention-spam and member-profile rules fire
 * `AUTO_MODERATION_ACTION_EXECUTION` too, but the port dropped both features (08 and 15), so listing their
 * rules here would offer a policy against something this bot deliberately does not respond to.
 */
const POLICYABLE_TRIGGERS = new Set<number>([
	AutoModerationRuleTriggerType.Keyword,
	AutoModerationRuleTriggerType.KeywordPreset,
	AutoModerationRuleTriggerType.Spam,
]);

/**
 * Reads the guild's native AutoMod rules through the bot's token.
 *
 * **Read-only, permanently.** This product never writes a rule -- not here, not from the P9 migration. The
 * consequence, accepted knowingly: adding a banned word is a two-step job (add the keyword in Discord's own UI,
 * then attach a policy here), and a keyword removed on Discord's side leaves its policy behind as an orphan the
 * editor renders rather than silently deletes. What it buys is that a policy can only ever name a keyword that
 * actually exists, so the failure this feature is most prone to -- a policy configured against a word no rule
 * contains, which fires nothing and errors nowhere -- is unrepresentable.
 *
 * Uncached on purpose, unlike `fetchGuildChannels`: this is a configuration screen read once per visit, and a
 * five-minute stale rule list would show a manager keywords they just deleted in another tab.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/automod-rules',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListAutomodRulesResult> {
		try {
			const rules = await discordAPIAutomoderator.guilds.getAutoModerationRules(req.params.guildId);

			return {
				available: true,
				rules: rules.filter((rule) => POLICYABLE_TRIGGERS.has(rule.trigger_type as number)).map(summarize),
			};
		} catch (error) {
			// Branching on the JSON error *code*, not the HTTP status, because both states are 403: a bot that is
			// not in the guild gets `MissingAccess` (50001) and one that is but lacks Manage Server gets
			// `MissingPermissions` (50013). Discord only 404s an unknown guild id, which a dashboard listing
			// guilds it is installed in can barely produce -- so keying on status alone told a manager whose bot
			// had just been removed to go grant a permission.
			if (error instanceof DiscordAPIError) {
				if (error.code === RESTJSONErrorCodes.MissingPermissions) {
					return { available: false, reason: 'missing-permission' };
				}

				if (error.code === RESTJSONErrorCodes.MissingAccess || error.status === 404) {
					return { available: false, reason: 'missing-access' };
				}
			}

			getContext().logger.error({ err: error, guildId: req.params.guildId }, 'failed to read AutoMod rules');
			throw error;
		}
	},
});
