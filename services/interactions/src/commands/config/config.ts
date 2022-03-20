import type { ConfigCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { UserPerms } from '@automoderator/util';
import { Rest } from '@chatsift/api-wrapper';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import {
	APIThreadChannel,
	APIGuildInteraction,
	APIPartialChannel,
	APIWebhook,
	ChannelType,
	InteractionResponseType,
	RESTPostAPIChannelWebhookJSONBody,
	Routes,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';
import { GuildSettings, LogChannelType, LogChannelWebhook, PrismaClient } from '@prisma/client';
import ms from '@naval-base/ms';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly handler: Handler,
		public readonly prisma: PrismaClient,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
	) {}

	private _sendCurrentSettings(
		interaction: APIGuildInteraction,
		settings: Partial<GuildSettings>,
		logChannels: Map<LogChannelType, LogChannelWebhook>,
	) {
		const atRole = (role?: string | null) => (role ? `<@&${role}>` : 'none');
		const atChannel = (channel?: string | null) => (channel ? `<#${channel}>` : 'none');
		const atLogChannel = (type: LogChannelType) =>
			logChannels.has(type) ? atChannel(logChannels.get(type)!.channelId) : 'none';

		return send(interaction, {
			content: stripIndents`
        **Here are your current settings:**
        • mute role: ${atRole(settings.muteRole)}
        • automatically pardon warnings after: ${
					settings.autoPardonWarnsAfter ? `${settings.autoPardonWarnsAfter} days` : 'never'
				}
        • automatically kick users with accounts younger than: ${
					settings.minJoinAge ? ms(settings.minJoinAge, true) : 'disabled'
				}
        • no blank avatar: ${settings.noBlankAvatar ? 'on' : 'off'}
				• reports channel: ${atChannel(settings.reportsChannel)}
				• mod log channel: ${atLogChannel(LogChannelType.mod)}
				• filter log channel: ${atLogChannel(LogChannelType.filter)}
				• user log channel: ${atLogChannel(LogChannelType.user)}
				• message log channel: ${atLogChannel(LogChannelType.message)}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigCommand>) {
		void send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

		const {
			muterole,
			pardonwarnsafter,
			joinage,
			blankavatar,
			reportschannel,
			filterlogschannel,
			messagelogschannel,
			modlogschannel,
			userlogschannel,
		} = args;

		let settings: Partial<GuildSettings> = {};

		if (muterole) {
			settings.muteRole = muterole.id;
		}

		if (pardonwarnsafter != null) {
			settings.autoPardonWarnsAfter = pardonwarnsafter;
		}

		const textTypes = [ChannelType.GuildText, ChannelType.GuildPublicThread, ChannelType.GuildPrivateThread];

		if (joinage) {
			let parsed: number;

			const joinageMinutes = Number(joinage);

			if (isNaN(joinageMinutes)) {
				const joinageMs = ms(joinage);
				if (!joinageMs) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				parsed = joinageMs;
			} else {
				parsed = joinageMinutes * 6e4;
			}

			if (parsed < 3 * 6e4) {
				throw new ControlFlowError('Please provide at least 3 minutes');
			}

			settings.minJoinAge = parsed;
		}

		if (blankavatar != null) {
			settings.noBlankAvatar = blankavatar;
		}

		if (reportschannel != null) {
			if (!textTypes.includes(reportschannel.type)) {
				throw new ControlFlowError('Reports channel must be a text channel');
			}

			settings.reportsChannel = reportschannel.id;
		}

		settings = await this.prisma.guildSettings.upsert({
			create: { ...settings, guildId: interaction.guild_id },
			update: settings,
			where: { guildId: interaction.guild_id },
		});

		const logChannels = await this.prisma.$transaction(async (prisma) => {
			const existingLogChannels = await prisma.logChannelWebhook
				.findMany({ where: { guildId: interaction.guild_id } })
				.then((channels) => new Map(channels.map((channel) => [channel.logType, channel])));

			const logChannels: Promise<LogChannelWebhook>[] = [];

			const handleLogChannel = async (channel: APIPartialChannel, logType: LogChannelType) => {
				if (!textTypes.includes(channel.type)) {
					throw new ControlFlowError('A log channel must be a text channel');
				}

				const parentId =
					channel.type === ChannelType.GuildText
						? channel.id
						: (await this.discordRest.get<APIThreadChannel>(Routes.channel(channel.id)))!.parent_id!;

				const webhook = await this.discordRest.post<APIWebhook, RESTPostAPIChannelWebhookJSONBody>(
					Routes.channelWebhooks(parentId),
					{
						data: {
							name: `${logType[0]!.toUpperCase()}${logType.slice(1)} Logs`,
							// TODO(DD): Avatars need to be served somewhere
						},
					},
				);

				const data = {
					guildId: interaction.guild_id,
					logType,
					channelId: parentId,
					webhookId: webhook.id,
					webhookToken: webhook.token!,
					threadId: channel.type === ChannelType.GuildText ? null : channel.id,
				};

				logChannels.push(
					prisma.logChannelWebhook.upsert({
						create: data,
						update: data,
						where: {
							guildId_logType: {
								guildId: interaction.guild_id,
								logType,
							},
						},
					}),
				);

				existingLogChannels.delete(logType);
			};

			if (filterlogschannel) {
				await handleLogChannel(filterlogschannel, LogChannelType.filter);
			}

			if (messagelogschannel) {
				await handleLogChannel(messagelogschannel, LogChannelType.message);
			}

			if (modlogschannel) {
				await handleLogChannel(modlogschannel, LogChannelType.mod);
			}

			if (userlogschannel) {
				await handleLogChannel(userlogschannel, LogChannelType.user);
			}

			for (const channel of await Promise.all(logChannels)) {
				existingLogChannels.set(channel.logType, channel);
			}

			return existingLogChannels;
		});

		return this._sendCurrentSettings(interaction, settings, logChannels);
	}
}
