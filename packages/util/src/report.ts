import { Rest } from '@cordis/rest';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';
import { PrismaClient } from '@prisma/client';
import {
	RESTPostAPIChannelMessageResult,
	RESTPostAPIChannelMessageJSONBody,
	APIUser,
	RouteBases,
	ButtonStyle,
	ComponentType,
	Routes,
	GatewayMessageCreateDispatchData,
} from 'discord-api-types/v9';
import { singleton } from 'tsyringe';

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

	public async reportMessage(
		message: GatewayMessageCreateDispatchData,
		reporter: APIUser,
		reportsChannel: string,
		reason: string,
	) {
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
				const report = await prisma.report.create({
					data: {
						userId: message.author.id,
						messageId: message.id,
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
											custom_id: `report|${report.reportId}|acknowledge`,
										},
										{
											type: ComponentType.Button,
											label: 'View reporters',
											style: ButtonStyle.Primary,
											custom_id: `report|${report.reportId}|view-reporters`,
										},
										{
											type: ComponentType.Button,
											label: 'Action',
											style: ButtonStyle.Danger,
											custom_id: `report|${report.reportId}|action`,
										},
									],
								},
							],
						},
					},
				);

				await prisma.report.update({
					data: {
						reportMessageId: reportMessage.id,
					},
					where: {
						reportId: report.reportId,
					},
				});
			}
		});
	}

	public async reportUser(target: APIUser, reporter: APIUser, reportsChannel: string, reason: string) {
		const reporterData = {
			tag: `${reporter.username}#${reporter.discriminator}`,
			id: reporter.id,
			avatar: reporter.avatar
				? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${reporter.id}/${reporter.avatar}`)
				: `${RouteBases.cdn}/embed/avatars/${parseInt(reporter.discriminator, 10) % 5}.png`,
		};

		return this.prisma.$transaction(async (prisma) => {
			const existingReport = await prisma.report.findFirst({
				where: { userId: target.id, messageId: null },
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
				const report = await prisma.report.create({
					data: {
						userId: target.id,
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

				const reportMessage = await this.rest.post<RESTPostAPIChannelMessageResult, RESTPostAPIChannelMessageJSONBody>(
					Routes.channelMessages(reportsChannel),
					{
						data: {
							embeds: [
								{
									color: 15953004,
									author: {
										name: `${target.username}#${target.discriminator} (${target.id})`,
										icon_url: target.avatar
											? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${target.id}/${target.avatar}`)
											: `${RouteBases.cdn}/embed/avatars/${parseInt(target.discriminator, 10) % 5}.png`,
									},
									description: 'Was reported',
								},
							],
							components: [
								{
									type: ComponentType.ActionRow,
									components: [
										{
											type: ComponentType.Button,
											label: 'Review',
											style: ButtonStyle.Secondary,
											custom_id: 'NOOP',
											disabled: true,
										},
										{
											type: ComponentType.Button,
											label: 'Dismiss',
											style: ButtonStyle.Success,
											custom_id: `report|${report.reportId}|acknowledge`,
										},
										{
											type: ComponentType.Button,
											label: 'View reporters',
											style: ButtonStyle.Primary,
											custom_id: `report|${report.reportId}|view-reporters`,
										},
										{
											type: ComponentType.Button,
											label: 'Action',
											style: ButtonStyle.Danger,
											custom_id: `report|${report.reportId}|action`,
										},
									],
								},
							],
						},
					},
				);

				await prisma.report.update({
					data: {
						reportMessageId: reportMessage.id,
					},
					where: {
						reportId: report.reportId,
					},
				});
			}
		});
	}
}
