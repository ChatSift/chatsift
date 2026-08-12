import { templateString } from '@chatsift/core';

/**
 * The two user-authored strings Social renders: a guild's level-up notification
 * (`social_guild_settings.level_up_notification_message`) and a social interaction's content/plain content
 * (`social_interactions.content`, `.plain_content`).
 *
 * Substitution itself is `@chatsift/bot-core`'s shared `templateString`, so the syntax matches ModMail's exactly
 * -- including tolerating whitespace inside the braces. Legacy Social required precisely `{{ name }}`, so a
 * migrated template containing a literal `{{name}}` now resolves where it used to render as-is. Deliberate: one
 * syntax across the products beats bug-for-bug fidelity on a case nobody was relying on.
 */

export interface LevelUpTemplateData {
	/**
	 * Pre-formatted *with a leading space* -- ` and received: Regular, Veteran`, or empty. The default message
	 * below appends it directly after the guild name, so the spacing lives in the value rather than the template.
	 */
	earnedRewards: string;
	guildName: string;
	level: string;
	username: string;
}

export interface SocialInteractionTemplateData {
	/**
	 * The invoking user, as a mention.
	 */
	author: string;
	/**
	 * The targeted users as mentions joined by `, `, or empty when the interaction takes no targets (or was
	 * invoked without any).
	 */
	targets: string;
}

/**
 * Used when a guild has no `level_up_notification_message` of its own. Kept here rather than defaulted in the
 * column so it can change without a data migration -- the same reasoning `guild_settings.anon_reply_label` uses.
 */
export const DEFAULT_LEVEL_UP_MESSAGE =
	'{{ username }}, you just reached level {{ level }} in {{ guildName }}{{ earnedRewards }}!';

export function templateLevelUpMessage(content: string, data: LevelUpTemplateData): string {
	return templateString(content, data);
}

export function templateSocialInteraction(content: string, data: SocialInteractionTemplateData): string {
	return templateString(content, data);
}
