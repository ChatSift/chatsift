import { kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { GuildSettings, MessageReporter, ReportedMessage } from '@automoderator/core';
import {
	RESTPatchAPIChannelMessageJSONBody,
	RESTPostAPIChannelMessageResult,
	RESTPostAPIChannelMessageJSONBody,
	APIUser,
	APIGuildMember,
	RouteBases,
	APIMessage,
	ButtonStyle,
	ComponentType,
	Snowflake,
	Routes,
} from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { container } from 'tsyringe';
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

export const reportMessage = async (
	guildId: Snowflake,
	reporterUser: APIUser,
	message: APIMessage,
	settings: GuildSettings,
) => {
	const sql = container.resolve<Sql<{}>>(kSql);
	const rest = container.resolve(Rest);

	const reporter = {
		tag: `${reporterUser.username}#${reporterUser.discriminator}`,
		id: reporterUser.id,
		avatar: reporterUser.avatar
			? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${reporterUser.id}/${reporterUser.avatar}`)
			: `${RouteBases.cdn}/embed/avatars/${parseInt(reporterUser.discriminator, 10) % 5}.png`,
	};

	return sql.begin<void>(async (sql) => {
		const [existingReport] = await sql<
			[ReportedMessage?]
		>`SELECT * FROM reported_messages WHERE message_id = ${message.id}`;

		if (existingReport) {
			if (existingReport.ack) {
				return Promise.reject(new ReportFailure(ReportFailureReason.previouslyAck));
			}

			const reporters = await sql<MessageReporter[]>`SELECT * FROM message_reporters WHERE message_id = ${message.id}`;
			if (reporters.find((r) => r.reporter_id === reporter.id)) {
				return Promise.reject(new ReportFailure(ReportFailureReason.alreadyReported));
			}

			const originalReport = reporters.find((reporter) => reporter.original)!;
			const originalMessage = await rest.get<APIMessage>(
				Routes.channelMessage(settings.reports_channel!, existingReport.report_message_id),
			);
			const embed = originalMessage.embeds[0]!;

			await rest.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
				Routes.channelMessage(settings.reports_channel!, existingReport.report_message_id),
				{
					data: {
						embeds: [
							{
								...embed,
								footer: {
									text: `Reported by: ${originalReport.reporter_tag} (${originalReport.reporter_id}) and ${reporters.length} others`,
									icon_url: embed.footer!.icon_url,
								},
							},
						],
					},
				},
			);

			await sql`
        INSERT INTO message_reporters (message_id, reporter_id, reporter_tag)
        VALUES (
          ${message.id},
          ${reporter.id},
          ${reporter.tag}
        )
      `;
		} else {
			const id = nanoid();

			const reportMessage = await rest.post<RESTPostAPIChannelMessageResult, RESTPostAPIChannelMessageJSONBody>(
				Routes.channelMessages(settings.reports_channel!),
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
								title: `Had their message posted <t:${Math.round(
									getCreationData(message.id).createdTimestamp / 1000,
								)}:R> reported`,
								description: message.content.length ? `\`\`\`${message.content}\`\`\`` : 'No text content',
								image: message.attachments[0]
									? {
											url: message.attachments[0].url,
									  }
									: undefined,
								footer: {
									text: `Reported by: ${reporter.tag} (${reporter.id})`,
									icon_url: reporter.avatar,
								},
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
										url: `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`,
									},
									{
										type: ComponentType.Button,
										label: 'Actioned',
										style: ButtonStyle.Secondary,
										custom_id: `report|${id}|${message.id}|action`,
									},
									{
										type: ComponentType.Button,
										label: 'Acknowledged',
										style: ButtonStyle.Secondary,
										custom_id: `report|${id}|${message.id}|acknowledge`,
									},
								],
							},
						],
					},
				},
			);

			await sql`
        INSERT INTO reported_messages (message_id, report_message_id)
        VALUES (${message.id}, ${reportMessage.id})
      `;

			await sql`
        INSERT INTO message_reporters (message_id, original, reporter_id, reporter_tag)
        VALUES (
          ${message.id},
          true,
          ${reporter.id},
          ${reporter.tag}
        )
      `;
		}
	});
};

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
		Routes.channelMessages(settings.reports_channel!),
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
