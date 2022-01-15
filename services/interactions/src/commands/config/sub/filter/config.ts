import type { FilterCommand } from '#interactions';
import { ArgumentsOf, FilterIgnoresStateStore, send } from '#util';
import type {
	ApiGetGuildsSettingsResult,
	ApiPatchGuildSettingsBody,
	ApiPatchGuildSettingsResult,
	GuildSettings,
} from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { singleton } from 'tsyringe';
import type { Command } from '../../../../command';

@singleton()
export class FilterConfig implements Command {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly filterIgnoreState: FilterIgnoresStateStore,
	) {}

	private async sendCurrentSettings(interaction: APIGuildInteraction, settings?: Partial<GuildSettings> | null) {
		settings ??= await this.rest
			.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`)
			.catch(() => null);

		return send(interaction, {
			content: stripIndents`
        **Here are your current filter settings:**
        • url filter: ${settings?.use_url_filters ? 'on' : 'off'}
        • global filter: ${settings?.use_global_filters ? 'on' : 'off'}
        • file filter: ${settings?.use_file_filters ? 'on' : 'off'}
        • invite filter: ${settings?.use_invite_filters ? 'on' : 'off'}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['config']) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show': {
				return this.sendCurrentSettings(interaction);
			}

			case 'edit': {
				let settings: Partial<GuildSettings> = {};

				if (args.edit.urls != null) {
					settings.use_url_filters = args.edit.urls;
				}

				if (args.edit.files != null) {
					settings.use_file_filters = args.edit.files;
				}

				if (args.edit.invites != null) {
					settings.use_invite_filters = args.edit.invites;
				}

				if (args.edit.global != null) {
					settings.use_global_filters = args.edit.global;
				}

				if (!Object.values(settings).length) {
					return this.sendCurrentSettings(interaction);
				}

				settings = await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(
					`/guilds/${interaction.guild_id}/settings`,
					settings,
				);

				return this.sendCurrentSettings(interaction, settings);
			}
		}
	}
}
