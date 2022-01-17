import type { ConfigNsfwDetectionCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import type {
	ApiGetGuildsSettingsResult,
	ApiPatchGuildSettingsBody,
	ApiPatchGuildSettingsResult,
	GuildSettings,
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@chatsift/api-wrapper';
import { kLogger, kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kSql) public readonly sql: Sql<{}>,
	) {}

	private _sendCurrentSettings(interaction: APIGuildInteraction, settings: Partial<GuildSettings>) {
		return send(interaction, {
			content: stripIndents`
        **Here are your current settings:**
        • hentai threshold: ${settings.hentai_threshold ? `${settings.hentai_threshold}%` : 'not set'}
        • porn threshold: ${settings.porn_threshold ? `${settings.porn_threshold}%` : 'not set'}
        • sexy threshold: ${settings.sexy_threshold ? `${settings.sexy_threshold}%` : 'not set'}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigNsfwDetectionCommand>) {
		if (!Object.values(args).length) {
			const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);
			return this._sendCurrentSettings(interaction, settings);
		}

		const { hentai, porn, sexy } = args;

		await send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

		let settings: Partial<GuildSettings> = {};

		if (hentai) {
			settings.hentai_threshold = hentai;
		}

		if (porn) {
			settings.porn_threshold = porn;
		}

		if (sexy) {
			settings.sexy_threshold = sexy;
		}

		settings = Object.values(settings).length
			? await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(
					`/guilds/${interaction.guild_id}/settings`,
					settings,
			  )
			: await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

		return this._sendCurrentSettings(interaction, settings);
	}
}
