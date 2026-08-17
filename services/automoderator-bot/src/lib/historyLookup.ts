import { HISTORY_TOKEN_TTL_MINUTES, getContext, mintHistoryToken } from '@chatsift/backend-core';
import type { APIApplicationCommandInteraction, APIUser } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { buildHistoryEmbed } from './caseHistory.js';
import { getModLogWebhook } from './caseLog.js';
import { listCasesForTarget } from './cases.js';
import { caseBrowserLink, publicHistoryLink } from './dashboardLinks.js';

/**
 * Shared by `/history`, the History user context menu, and `/myhistory` — three entry points onto one embed.
 */
export interface HistoryReplyOptions {
	/**
	 * The invoker is looking at their own history, so link them at the token page rather than the dashboard.
	 */
	readonly self?: boolean;
}

export async function replyWithHistory(
	interaction: APIApplicationCommandInteraction,
	target: APIUser,
	guildId: string,
	options: HistoryReplyOptions = {},
): Promise<void> {
	const api = getContext().service.client.api;

	// Deferred before any of the work below. Reading the case list and minting a token are both round trips,
	// and Discord gives an interaction three seconds — past that the token is dead and the reply can't land.
	await api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

	const [cases, webhook] = await Promise.all([listCasesForTarget(guildId, target.id), getModLogWebhook(guildId)]);

	const embed = buildHistoryEmbed(target, cases, { logChannelId: webhook?.channelId ?? null });

	let link: string;
	let linkLabel: string;

	if (options.self) {
		const token = await mintHistoryToken({ guildId, userId: target.id });
		link = publicHistoryLink(token);
		linkLabel = `View your full history (link expires in ${HISTORY_TOKEN_TTL_MINUTES} minutes)`;
	} else {
		link = caseBrowserLink(guildId, target.id);
		linkLabel = 'View the full history on the dashboard';
	}

	embed.description = `${embed.description ?? ''}\n\n[${linkLabel}](${link})`.trim();
	await api.interactions.editReply(interaction.application_id, interaction.token, { embeds: [embed] });
}
