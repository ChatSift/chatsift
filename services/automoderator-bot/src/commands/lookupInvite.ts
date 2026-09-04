import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { extractInviteCodes } from '@chatsift/core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type { APIApplicationCommandInteraction, APIChatInputApplicationCommandInteraction } from '@discordjs/core';
import { ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { ChatInputInteractionOptionResolver } from '@sapphire/discord-utilities';
import { buildInviteLookupEmbed, hasGuild } from '../lib/inviteLookup.js';

/**
 * `/lookup-invite` (P6, feature 26): what server is behind this link.
 *
 * **Resolved with the bot's own REST client.** Legacy asked a Cloudflare worker at
 * `invite-lookup.chatsift.workers.dev`, which is still live, has no source in any repo, and exists only because
 * legacy's `discord-proxy` cached invite responses in a way that made a direct fetch unreliable. Nothing here
 * needs it -- see the port doc's new-stack mapping, which drops it.
 *
 * A bare code is accepted as readily as a full link, because the thing a moderator has in their clipboard is
 * whichever of the two the person they are investigating happened to post.
 */
const BARE_CODE = /^[\w-]{2,}$/;

export default class LookupInviteCommand implements CommandHandler {
	public readonly name = 'lookup-invite';

	public readonly data = new ChatInputCommandBuilder()
		.setName('lookup-invite')
		.setDescription('Look up which server an invite leads to')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addStringOptions((option) =>
			option.setName('invite').setDescription('The invite link or code to look up').setRequired(true).setMaxLength(200),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger): Promise<void> {
		const api = getContext().service.client.api;

		await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const raw = options.getString('invite', true).trim();
		// The same extractor the invite filter runs on message content, so a link this command says leads
		// somewhere is the same link the filter would read the same way.
		const code = extractInviteCodes(raw)[0] ?? (BARE_CODE.test(raw) ? raw : null);

		const reply = async (content: string) => {
			await api.interactions.editReply(interaction.application_id, interaction.token, {
				content,
				allowed_mentions: { parse: [] },
			});
		};

		if (code === null) {
			await reply("That doesn't look like an invite. Paste the link, or just the code from the end of it.");
			return;
		}

		let invite;
		try {
			invite = await api.invites.get(code, { with_counts: true, with_expiration: true });
		} catch (error) {
			// Expired, revoked, mistyped, or a code that never existed -- Discord answers all four with a 404, and
			// none of them is worth an error log. Anything else is, because it is us rather than the invite.
			const status = (error as { status?: number } | null)?.status;
			if (status !== 404) {
				logger.warn({ err: error, code }, 'failed to look up an invite');
			}

			await reply(
				status === 404
					? 'That invite is invalid or has expired, so there is nothing to look up.'
					: 'Discord would not tell me about that invite. Try again in a moment.',
			);
			return;
		}

		// A group-DM invite resolves fine and has no guild behind it, which is a real answer rather than a
		// failure -- and one worth stating, because it means the link is not an advertisement for a server.
		if (!hasGuild(invite)) {
			await reply('That invite does not lead to a server — it is a group DM invite.');
			return;
		}

		await api.interactions.editReply(interaction.application_id, interaction.token, {
			embeds: [buildInviteLookupEmbed(invite)],
		});
	}
}
