import { FilterCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import type {
	ApiDeleteFiltersInvitesAllowlistCodeResult,
	ApiGetFiltersInvitesAllowlistResult,
	ApiPutFiltersInvitesAllowlistCodeResult,
} from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { HTTPError, Rest as DiscordRest } from '@cordis/rest';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { singleton } from 'tsyringe';
import { Command } from '../../../../command';

@singleton()
export class InvitesConfig implements Command {
	public constructor(public readonly rest: Rest, public readonly discordRest: DiscordRest) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['invites']) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'allow': {
				try {
					await this.rest.put<ApiPutFiltersInvitesAllowlistCodeResult>(
						`/guilds/${interaction.guild_id}/filters/invites/allowlist/${args.allow.guild}`,
					);

					return send(interaction, { content: 'Successfully added the given guild to the allowlist' });
				} catch (error) {
					if (error instanceof HTTPError && error.response.status === 409) {
						return send(interaction, { content: 'There was nothing to add!', flags: 64 });
					}

					throw error;
				}
			}

			case 'unallow': {
				try {
					await this.rest.delete<ApiDeleteFiltersInvitesAllowlistCodeResult>(
						`/guilds/${interaction.guild_id}/filters/inviters/allowlist/${args.unallow.guild}`,
					);

					return send(interaction, { content: 'Successfully removed the given entries from the given allowlist' });
				} catch (error) {
					if (error instanceof HTTPError && error.response.status === 404) {
						return send(interaction, { content: 'There was nothing to delete!', flags: 64 });
					}

					throw error;
				}
			}

			case 'list': {
				const allows = await this.rest.get<ApiGetFiltersInvitesAllowlistResult>(
					`/guilds/${interaction.guild_id}/filters/invites/allowlist`,
				);

				if (!allows.length) {
					return send(interaction, { content: 'There is currently nothing on your allowlist' });
				}

				const content = allows.map((entry) => entry.allowed_guild_id).join('\n');

				return send(interaction, {
					content: "Here's your list",
					files: [{ name: 'allowlist.txt', content: Buffer.from(content) }],
				});
			}
		}
	}
}
