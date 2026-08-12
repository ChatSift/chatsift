import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { SocialInteractions } from '@chatsift/db';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIEmbed,
	APIInteractionResponseCallbackData,
} from '@discordjs/core';
import { AllowedMentionsTypes, ApplicationCommandOptionType, ApplicationCommandType } from '@discordjs/core';
import { templateSocialInteraction } from './templateMessage.js';

/**
 * Social interaction dispatch (#343 P3, redesign ledger item 3).
 *
 * These commands are minted per guild by the API (`services/api/src/routes/social/interactions/*`), never by this
 * bot, so there's no static `CommandHandler` for them -- they arrive through `@chatsift/bot-core`'s
 * `registerUnknownCommandResolver` hook, the same route ModMail's snippets take.
 */

/**
 * Discord's blurple, used when an interaction has no colour configured or has one this can't parse. Legacy fell
 * back to the same colour, though it would throw on a malformed value rather than degrading.
 */
const DEFAULT_EMBED_COLOR = 0x58_65_f2;

/**
 * `#rrggbb` (the format `createSocialInteractionBodySchema` enforces on write) to the integer Discord wants.
 * Stored as a string because that's what legacy stored and reinterpreting the column would need a data
 * migration to be sure of -- see schema.sql.
 */
function parseColor(color: string | null): number {
	if (!color) {
		return DEFAULT_EMBED_COLOR;
	}

	const parsed = Number.parseInt(color.replace(/^#/, ''), 16);
	return Number.isNaN(parsed) ? DEFAULT_EMBED_COLOR : parsed;
}

/**
 * Builds `{{ targets }}` from the command's user options.
 *
 * The option names (`user`, `user2`, `user3`) are set by `buildInteractionCommandBody` in the API and are a
 * contract between the two services. Reading them positionally out of `data.options` rather than by name would
 * be equivalent today, but by-type filtering keeps this correct if the body ever gains a non-user option.
 */
function resolveTargets(interaction: APIChatInputApplicationCommandInteraction): string {
	const options = interaction.data.options ?? [];

	return options
		.filter((option) => option.type === ApplicationCommandOptionType.User)
		.map((option) => `<@${option.value}>`)
		.join(', ');
}

function buildResponse(
	interaction: SocialInteractions,
	content: string,
	plainContent: string | null,
): APIInteractionResponseCallbackData {
	// Target mentions are the point of the feature, so users stay pingable -- but a guild-authored string must
	// not be able to smuggle an `@everyone` or a role ping through stored content.
	const allowed_mentions = { parse: [AllowedMentionsTypes.User] };

	if (!interaction.embed) {
		// Legacy passed the attachment as `files: [url]`, re-uploading it through the bot on every single
		// invocation. Appending the URL lets Discord unfurl it instead: visually the same for the image URLs
		// this field holds, without proxying user-supplied URLs on a per-use basis.
		const withAttachment = interaction.attachmentUrl ? `${content}\n${interaction.attachmentUrl}` : content;

		return { content: withAttachment, allowed_mentions };
	}

	const embed: APIEmbed = {
		description: content,
		color: parseColor(interaction.color),
		...(interaction.attachmentUrl ? { image: { url: interaction.attachmentUrl } } : {}),
	};

	return {
		...(plainContent ? { content: plainContent } : {}),
		embeds: [embed],
		allowed_mentions,
	};
}

/**
 * Looks the invoked command up in `social_interactions`.
 *
 * The `command_id` match is the fast path. The `(guild_id, name)` fallback is mandated by the schema: every row
 * the legacy migration writes has a NULL `command_id` (ids belong to the application that minted them), so
 * immediately post-cutover the fallback is the *only* path that resolves anything until a resync runs.
 */
async function findInteraction(
	guildId: string,
	commandId: string,
	name: string,
): Promise<SocialInteractions | undefined> {
	const db = getContext().db;

	const [byCommandId] = await db<SocialInteractions[]>`
		SELECT * FROM social_interactions WHERE guild_id = ${guildId} AND command_id = ${commandId}
	`;

	if (byCommandId) {
		return byCommandId;
	}

	const [byName] = await db<SocialInteractions[]>`
		SELECT * FROM social_interactions WHERE guild_id = ${guildId} AND name = ${name}
	`;

	return byName;
}

/**
 * Returns `true` when this was one of ours and has been fully handled (including the reply), `false` to let
 * bot-core fall through to its usual "no handler found" response.
 */
export async function handleSocialInteractionCommand(
	interaction: APIApplicationCommandInteraction,
	logger: Logger,
): Promise<boolean> {
	if (interaction.data.type !== ApplicationCommandType.ChatInput || !interaction.guild_id) {
		return false;
	}

	const chatInput = interaction as APIChatInputApplicationCommandInteraction;
	const row = await findInteraction(interaction.guild_id, interaction.data.id, interaction.data.name);
	if (!row) {
		return false;
	}

	if (row.commandId !== interaction.data.id) {
		// Resolved by name, so this row is pointing at a command id that no longer exists (or none at all).
		// Repairing it here means a migrated guild self-heals on first use instead of waiting for someone to
		// press the resync button.
		//
		// Best-effort: `UNIQUE (guild_id, command_id)` can legitimately reject this while a stale row still
		// holds the id, and that's a resync's job to untangle -- it must not stop the interaction from working.
		try {
			await getContext().db`
				UPDATE social_interactions SET command_id = ${interaction.data.id} WHERE id = ${row.id}
			`;
		} catch (error) {
			logger.warn(
				{ err: error, guildId: interaction.guild_id, interactionId: row.id },
				'Failed to self-heal a social interaction command id',
			);
		}
	}

	const templateData = {
		author: `<@${(interaction.member?.user ?? interaction.user)!.id}>`,
		targets: resolveTargets(chatInput),
	};

	const content = templateSocialInteraction(row.content, templateData);
	const plainContent = row.plainContent ? templateSocialInteraction(row.plainContent, templateData) : null;

	await getContext().service.client.api.interactions.reply(
		interaction.id,
		interaction.token,
		buildResponse(row, content, plainContent),
	);

	// Best-effort, after the reply -- the interaction has already been answered successfully at this point, so a
	// failed counter write shouldn't surface as an error. (Legacy left this unguarded, where a failure became an
	// unhandled rejection.)
	try {
		await getContext().db`UPDATE social_interactions SET uses = uses + 1 WHERE id = ${row.id}`;
	} catch (error) {
		logger.warn(
			{ err: error, guildId: interaction.guild_id, interactionId: row.id },
			'Failed to record social interaction usage',
		);
	}

	return true;
}
