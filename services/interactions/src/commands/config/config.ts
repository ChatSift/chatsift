import { Config, kConfig, kLogger } from '@automoderator/injection';
import { UserPerms } from '@automoderator/util';
import { REST } from '@discordjs/rest';
import ms from '@naval-base/ms';
import type { GuildSettings, LogChannelWebhook } from '@prisma/client';
import { LogChannelType, PrismaClient } from '@prisma/client';
import { stripIndents } from 'common-tags';
import type {
	APIThreadChannel,
	APIGuildInteraction,
	APIPartialChannel,
	APIWebhook,
	RESTPostAPIChannelWebhookJSONBody,
} from 'discord-api-types/v9';
import { ChannelType, InteractionResponseType, Routes } from 'discord-api-types/v9';
import fetch from 'node-fetch';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '#handler';
import type { ConfigCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { ControlFlowError, send } from '#util';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(
		public readonly rest: REST,
		public readonly handler: Handler,
		public readonly prisma: PrismaClient,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
	) {}

	private async _sendCurrentSettings(
		interaction: APIGuildInteraction,
		settings: Partial<GuildSettings>,
		logChannels: Map<LogChannelType, LogChannelWebhook>,
	) {
		// eslint-disable-next-line unicorn/consistent-function-scoping
		const atRole = (role?: string | null) => (role ? `<@&${role}>` : 'none');
		// eslint-disable-next-line unicorn/consistent-function-scoping
		const atChannel = (channel?: string | null) => (channel ? `<#${channel}>` : 'none');
		const atLogChannel = (type: LogChannelType) => {
			const logChannel = logChannels.get(type)!;
			return logChannels.has(type) ? atChannel(logChannel.threadId ?? logChannel.channelId) : 'none';
		};

		return send(interaction, {
			content: stripIndents`
        **Here are your current settings:**
        • mute role: ${atRole(settings.muteRole)}
        • automatically pardon warnings after: ${
					settings.autoPardonWarnsAfter ? `${settings.autoPardonWarnsAfter} days` : 'never'
				}
        • automatically kick users with accounts younger than: ${
					settings.minJoinAge ? ms(Number(settings.minJoinAge), true) : 'disabled'
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

		if (pardonwarnsafter !== null) {
			settings.autoPardonWarnsAfter = pardonwarnsafter;
		}

		const textTypes = [ChannelType.GuildText, ChannelType.GuildPublicThread, ChannelType.GuildPrivateThread];

		if (joinage) {
			let parsed: number;

			const joinageMinutes = Number(joinage);

			if (Number.isNaN(joinageMinutes)) {
				const joinageMs = ms(joinage);
				if (!joinageMs) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				parsed = joinageMs;
			} else {
				parsed = joinageMinutes * 6e4;
			}

			if (parsed < 3 * 6e4) {
				throw new ControlFlowError('Please provide at least 3 minutes for the min join age');
			}

			settings.minJoinAge = BigInt(parsed);
		}

		if (blankavatar !== null) {
			settings.noBlankAvatar = blankavatar;
		}

		if (reportschannel !== null) {
			if (!textTypes.includes(reportschannel!.type)) {
				throw new ControlFlowError('Reports channel must be a text channel');
			}

			settings.reportsChannel = reportschannel!.id;
		}

		settings = await this.prisma.guildSettings.upsert({
			create: { ...settings, guildId: interaction.guild_id },
			update: settings,
			where: { guildId: interaction.guild_id },
		});

		const logChannels = await this.prisma.$transaction(
			async (prisma) => {
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
							: ((await this.rest.get(Routes.channel(channel.id))) as APIThreadChannel).parent_id!;

					const names = {
						[LogChannelType.mod]: 'CASE-ICO',
						[LogChannelType.filter]: 'FILTER-ICO',
						[LogChannelType.user]: 'USER-ICO',
						[LogChannelType.message]: 'MSG-ICO',
					} as const;

					const iconRes = await fetch(`https://automoderator.app/wp-content/uploads/2022/03/${names[logType]}.png`);
					const buffer = await iconRes.buffer();

					const body: RESTPostAPIChannelWebhookJSONBody = {
						name: `${logType[0]!.toUpperCase()}${logType.slice(1)} Logs`,
						avatar: `data:image/png;base64,${buffer.toString('base64')}`,
					};
					const webhook = (await this.rest.post(Routes.channelWebhooks(parentId), {
						body,
					})) as APIWebhook;

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
			},
			{ timeout: 30_000 },
		);

		return this._sendCurrentSettings(interaction, settings, logChannels);
	}
}
