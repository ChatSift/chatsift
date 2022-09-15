import { REST } from '@discordjs/rest';
import type { GuildSettings } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { stripIndents } from 'common-tags';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { ConfigNsfwDetectionCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { send } from '#util';

@injectable()
export default class implements Command {
	public constructor(public readonly rest: REST, public readonly prisma: PrismaClient) {}

	private async _sendCurrentSettings(interaction: APIGuildInteraction, settings?: Partial<GuildSettings> | null) {
		return send(interaction, {
			content: stripIndents`
        **Here are your current settings:**
        • hentai threshold: ${settings?.hentaiThreshold ? `${settings.hentaiThreshold}%` : 'not set'}
        • porn threshold: ${settings?.pornThreshold ? `${settings.pornThreshold}%` : 'not set'}
        • sexy threshold: ${settings?.sexyThreshold ? `${settings.sexyThreshold}%` : 'not set'}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigNsfwDetectionCommand>) {
		if (!Object.values(args).length) {
			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });
			return this._sendCurrentSettings(interaction, settings);
		}

		const { hentai, porn, sexy } = args;

		await send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

		const settings: Partial<GuildSettings> = {};

		if (hentai) {
			settings.hentaiThreshold = hentai;
		}

		if (porn) {
			settings.pornThreshold = porn;
		}

		if (sexy) {
			settings.sexyThreshold = sexy;
		}

		const updated = await this.prisma.guildSettings.upsert({
			create: {
				guildId: interaction.guild_id,
				...settings,
			},
			update: settings,
			where: {
				guildId: interaction.guild_id,
			},
		});

		return this._sendCurrentSettings(interaction, updated);
	}
}
