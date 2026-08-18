import type { Logger } from '@chatsift/backend-core';
import { countReporters, getContext, getReport } from '@chatsift/backend-core';
import type { AutomoderatorReports } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIInteractionGuildMember } from '@discordjs/core';
import { MessageFlags, PermissionFlagsBits } from '@discordjs/core';
import { memberHasPermission } from './permissions.js';
import { syncReportCard } from './reportCard.js';

/**
 * A resolved, authorized card interaction. Every button on the card needs the same four things, and getting any
 * one of them wrong is a security bug rather than a cosmetic one -- hence one place that does all four.
 */
export interface ResolvedCardInteraction {
	readonly member: APIInteractionGuildMember;
	readonly report: AutomoderatorReports;
}

/**
 * The floor for touching a report card at all. Individual *actions* are gated separately and more tightly by
 * `memberMayTakeAction` -- this only decides who may look at the queue's controls.
 */
const CARD_PERMISSION = PermissionFlagsBits.ModerateMembers;

export async function resolveCardInteraction(
	interaction: APIMessageComponentInteraction,
	reportId: string | undefined,
	logger: Logger,
): Promise<ResolvedCardInteraction | null> {
	const api = getContext().service.client.api;

	const reply = async (content: string) => {
		await api.interactions.reply(interaction.id, interaction.token, { content, flags: MessageFlags.Ephemeral });
	};

	if (!interaction.guild_id || !interaction.member) {
		await reply('This can only be used in a server.');
		return null;
	}

	const parsed = Number(reportId);
	if (!reportId || !Number.isSafeInteger(parsed)) {
		logger.warn({ customId: interaction.data.custom_id }, 'report component carried no usable report id');
		await reply('I could not work out which report that button belongs to.');
		return null;
	}

	const report = await getReport(parsed);

	// Guild-checked as well as found: report ids are a global sequence, so without this a card copied into
	// another server would operate on the original guild's report.
	if (report?.guildId !== interaction.guild_id) {
		await reply('That report no longer exists.');
		return null;
	}

	if (!memberHasPermission(interaction.member, CARD_PERMISSION)) {
		await reply('You need the Timeout Members permission to handle reports.');
		return null;
	}

	return { report, member: interaction.member };
}

/**
 * Rewrites the card for a report whose row has just changed. Reads the reporter count back rather than being
 * handed one, because every caller has just mutated the report and none of them knows the count.
 */
export async function refreshCard(report: AutomoderatorReports, logger: Logger): Promise<void> {
	await syncReportCard(report, { reporterCount: await countReporters(report.id) }, logger);
}
