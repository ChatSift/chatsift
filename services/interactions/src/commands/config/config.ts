import type { ConfigCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { UserPerms } from '@automoderator/util';
import { Rest } from '@chatsift/api-wrapper';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import { APIGuildInteraction, ChannelType } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';
import { GuildSettings, PrismaClient } from '@prisma/client';
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

	private _sendCurrentSettings(interaction: APIGuildInteraction, settings: Partial<GuildSettings>) {
		const atRole = (role?: string | null) => (role ? `<@&${role}>` : 'none');

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
				• reports channel: ${settings.reportsChannel ? `<#${settings.reportsChannel}>` : 'none'}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigCommand>) {
		const { muterole, pardonwarnsafter, joinage, blankavatar, reportschannel } = args;

		let settings: Partial<GuildSettings> = {};

		if (muterole) {
			settings.muteRole = muterole.id;
		}

		if (pardonwarnsafter != null) {
			settings.autoPardonWarnsAfter = pardonwarnsafter;
		}

		const textTypes = [ChannelType.GuildText, ChannelType.GuildPublicThread, ChannelType.GuildPrivateThread];

		if (joinage) {
			const joinageMinutes = Number(joinage);

			if (isNaN(joinageMinutes)) {
				const joinageMs = ms(joinage);
				if (!joinageMs) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				settings.minJoinAge = joinageMs;
			} else {
				settings.minJoinAge = joinageMinutes * 6e4;
			}
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

		void this._sendCurrentSettings(interaction, settings);
	}
}
