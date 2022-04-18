import { Rest } from '@cordis/rest';
import { PrismaClient, GuildSettings } from '@prisma/client';
import {
	RESTPostAPIChannelMessageResult,
	RESTPostAPIChannelMessageJSONBody,
	APIUser,
	APIGuildMember,
	RouteBases,
	APIMessage,
	ButtonStyle,
	ComponentType,
	Routes,
} from 'discord-api-types/v9';
import { container, singleton } from 'tsyringe';
import { nanoid } from 'nanoid';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';

export const enum ReportFailureReason {
	previouslyAck = 'This message has been reported previously and has since been acknowledged by the staff team.',
	alreadyReported = 'You have already reported this message.',
}

export class ReportFailure extends Error {
	public constructor(public readonly reason: ReportFailureReason) {
		super();
	}
}

@singleton()
export class ReportHandler {
	public constructor(public readonly prisma: PrismaClient, public readonly rest: Rest) {}

	public async reportMessage(message: APIMessage, reporter: APIUser, reportsChannel: string, reason: string) {
		const reporterData = {
			tag: `${reporter.username}#${reporter.discriminator}`,
			id: reporter.id,
			avatar: reporter.avatar
				? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${reporter.id}/${reporter.avatar}`)
				: `${RouteBases.cdn}/embed/avatars/${parseInt(reporter.discriminator, 10) % 5}.png`,
		};

		return this.prisma.$transaction(async (prisma) => {
			const existingReport = await prisma.report.findFirst({
				where: { messageId: message.id },
				include: { reporters: true },
			});

			if (existingReport) {
				if (existingReport.acknowledgedAt) {
					return Promise.reject(new ReportFailure(ReportFailureReason.previouslyAck));
				}

				if (existingReport.reporters.find((r) => r.reporterId === reporter.id)) {
					return Promise.reject(new ReportFailure(ReportFailureReason.alreadyReported));
				}

				await prisma.reporter.create({
					data: {
						reportId: existingReport.reportId,
						reporterId: reporter.id,
						reporterTag: reporterData.tag,
						reason,
					},
				});
			} else {
				const reportMessage = await this.rest.post<RESTPostAPIChannelMessageResult, RESTPostAPIChannelMessageJSONBody>(
					Routes.channelMessages(reportsChannel),
					{
						data: {
							embeds: [
								{
									color: 15953004,
									author: {
										name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`,
										icon_url: message.author.avatar
											? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${message.author.id}/${message.author.avatar}`)
											: `${RouteBases.cdn}/embed/avatars/${parseInt(message.author.discriminator, 10) % 5}.png`,
									},
									description: `Had their message posted <t:${Math.round(
										getCreationData(message.id).createdTimestamp / 1000,
									)}:R> in <#${message.channel_id}> reported. \n\n${
										message.content.length ? `\`\`\`${message.content}\`\`\`` : '*Message had no text content*'
									}`,
									image: message.attachments[0]
										? {
												url: message.attachments[0].url,
										  }
										: undefined,
								},
							],
							components: [
								{
									type: ComponentType.ActionRow,
									components: [
										{
											type: ComponentType.Button,
											label: 'Review',
											style: ButtonStyle.Link,
											url: `https://discord.com/channels/${message.guild_id!}/${message.channel_id}/${message.id}`,
										},
										{
											type: ComponentType.Button,
											label: 'Dismiss',
											style: ButtonStyle.Success,
											custom_id: `report-message|${message.id}|acknowledge`,
										},
										{
											type: ComponentType.Button,
											label: 'View reporters',
											style: ButtonStyle.Primary,
											custom_id: `report-message|${message.id}|view-reporters`,
										},
										{
											type: ComponentType.Button,
											label: 'Action',
											style: ButtonStyle.Danger,
											custom_id: `report-message|${message.id}|action`,
										},
									],
								},
							],
						},
					},
				);

				await prisma.report.create({
					data: {
						userId: message.author.id,
						messageId: message.id,
						reportMessageId: reportMessage.id,
						reporters: {
							create: [
								{
									reporterId: reporter.id,
									reporterTag: reporterData.tag,
									reason,
								},
							],
						},
					},
				});
			}
		});
	}
}

/**
 * Internal use only for name filtering
 */
export const reportUser = async (
	{ user: reportedUser, joined_at }: APIGuildMember & { user: APIUser },
	name: string,
	nick: boolean,
	words: string[],
	settings: GuildSettings,
) => {
	const rest = container.resolve(Rest);

	const id = nanoid();

	const joined = `<t:${Math.round(new Date(joined_at).getTime() / 1000)}:R>`;
	const age = `<t:${Math.round(getCreationData(reportedUser.id).createdTimestamp / 1000)}:R>`;

	await rest.post<RESTPostAPIChannelMessageResult, RESTPostAPIChannelMessageJSONBody>(
		Routes.channelMessages(settings.reportsChannel!),
		{
			data: {
				embeds: [
					{
						color: 15953004,
						author: {
							name: `${reportedUser.username}#${reportedUser.discriminator} (${reportedUser.id})`,
							icon_url: reportedUser.avatar
								? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${reportedUser.id}/${reportedUser.avatar}`)
								: `${RouteBases.cdn}/embed/avatars/${parseInt(reportedUser.discriminator, 10) % 5}.png`,
						},
						title: `Has been automatically reported for their ${nick ? 'nick' : 'user'}name`,
						description: `\`\`\`\n${name}\`\`\`\n<@${reportedUser.id}> joined ${joined}, ${age} old account`,
						footer: {
							text: `Filter triggers: ${words.join(', ')}`,
						},
					},
				],
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								label: 'Action this',
								style: ButtonStyle.Secondary,
								custom_id: `report-user|${id}|filter|${reportedUser.id}`,
							},
							{
								type: ComponentType.Button,
								label: 'Actioned',
								style: ButtonStyle.Secondary,
								custom_id: `report-user|${id}|action|${reportedUser.id}`,
							},
							{
								type: ComponentType.Button,
								label: 'Acknowledged',
								style: ButtonStyle.Secondary,
								custom_id: `report-user|${id}|acknowledge|${reportedUser.id}`,
							},
						],
					},
				],
			},
		},
	);
};
