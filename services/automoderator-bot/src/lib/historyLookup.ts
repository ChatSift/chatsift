import { getContext } from '@chatsift/backend-core';
import type { APIApplicationCommandInteraction, APIEmbed, APIUser } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { buildHistoryEmbed } from './caseHistory.js';
import { getModLogWebhook } from './caseLog.js';
import { listCasesForTarget } from './cases.js';

/**
 * Shared by `/history` and the History user context menu, which show exactly the same thing.
 */
export async function replyWithHistory(
	interaction: APIApplicationCommandInteraction,
	target: APIUser,
	guildId: string,
): Promise<void> {
	const api = getContext().service.client.api;

	const [cases, webhook] = await Promise.all([listCasesForTarget(guildId, target.id), getModLogWebhook(guildId)]);

	const embed: APIEmbed = buildHistoryEmbed(target, cases, { logChannelId: webhook?.channelId ?? null });

	await api.interactions.reply(interaction.id, interaction.token, {
		embeds: [embed],
		flags: MessageFlags.Ephemeral,
	});
}
