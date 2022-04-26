import { CaseManager, makeHistoryEmbed } from '@automoderator/util';
import { Case, LogChannelType, PrismaClient } from '@prisma/client';
import {
	APIGuildInteraction,
	APIGuildMember,
	APIMessageComponentInteraction,
	APIUser,
	ButtonStyle,
	ComponentType,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { container } from 'tsyringe';
import { Handler, CollectorTimeoutError } from '../../../handler';
import { send } from '../../../util';

export const handleLockConfirmation = async (
	interaction: APIGuildInteraction,
	member: APIGuildMember & { user: APIUser },
	locked: Case,
): Promise<boolean> => {
	const prisma = container.resolve(PrismaClient);
	const handler = container.resolve(Handler);
	const cases = container.resolve(CaseManager);

	const confirmId = nanoid();
	const historyId = nanoid();

	await send(interaction, {
		content: `This user was ${cases.formatActionName(locked.actionType)} by <@${locked.modId!}> <t:${Math.round(
			locked.createdAt.getTime() / 1000,
		)}:R>, are you sure you still want to ${locked.actionType} them?`,
		components: [
			{
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.Button,
						style: ButtonStyle.Success,
						custom_id: `${confirmId}|confirm`,
						label: 'Confirm',
					},
					{
						type: ComponentType.Button,
						style: ButtonStyle.Danger,
						custom_id: `${confirmId}|cancel`,
						label: 'Cancel',
					},
					{
						type: ComponentType.Button,
						style: ButtonStyle.Secondary,
						custom_id: historyId,
						label: 'History',
					},
				],
			},
		],
	});

	const history = await prisma.case.findMany({ where: { guildId: interaction.guild_id, targetId: member.user.id } });
	const filterTriggers = await prisma.filterTrigger.findFirst({
		where: { guildId: interaction.guild_id, userId: member.user.id },
	});
	const logWebhook = await prisma.logChannelWebhook.findFirst({
		where: { guildId: interaction.guild_id, logType: LogChannelType.mod },
	});

	const stop = handler.collectorManager
		.makeCollector<APIMessageComponentInteraction>(historyId)
		.hookAndDestroy((button) =>
			send(button, {
				embeds: [
					makeHistoryEmbed({
						user: member.user,
						cases: history,
						filterTriggers: filterTriggers?.count,
						logChannelId: logWebhook?.threadId ?? logWebhook?.channelId,
					}),
				],
				flags: 64,
			}),
		);

	try {
		const confirmation = await handler.collectorManager
			.makeCollector<APIMessageComponentInteraction>(confirmId)
			.waitForOneAndDestroy(30000);

		stop();
		const [, action] = confirmation.data.custom_id.split('|') as [string, string];
		if (action === 'cancel') {
			await send(interaction, { content: 'Cancelled.', components: [], embeds: [] });
			return false;
		}
	} catch (error) {
		if (error instanceof CollectorTimeoutError) {
			await send(interaction, { content: 'Timed out.', components: [], embeds: [] });
			return false;
		}

		throw error;
	}

	return true;
};
