import { FilterCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import type {
  ApiDeleteFiltersInvitesAllowlistCodeResult,
  ApiGetFiltersInvitesAllowlistResult,
  ApiPutFiltersInvitesAllowlistCodeResult
} from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import { singleton } from 'tsyringe';
import { Command } from '../../../../command';

@singleton()
export class InvitesConfig implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  private cleanInvite(invite: string) {
    return invite
      .replace(/(https?:\/\/)?(discord\.gg\/?)?/g, '')
      .replace(/ +/g, '');
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['invites']) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'allow': {
        const promises = [];

        for (const entry of args.allow.entries.split(',')) {
          const res = this.rest.put<ApiPutFiltersInvitesAllowlistCodeResult>(
            `/guilds/${interaction.guild_id}/filters/invites/allowlist/${this.cleanInvite(entry)}`
          );

          promises.push(res);
        }

        const added = (await Promise.allSettled(promises)).filter(promise => promise.status === 'fulfilled');

        if (!added.length) {
          return send(interaction, { content: 'There was nothing to add!', flags: 64 });
        }

        return send(interaction, { content: 'Successfully added the given entries to the allowlist' });
      }

      case 'unallow': {
        const promises = [];

        for (const entry of args.unallow.entries.split(',')) {
          const res = this.rest.delete<ApiDeleteFiltersInvitesAllowlistCodeResult>(
            `/guilds/${interaction.guild_id}/filters/invites/allowlist/${this.cleanInvite(entry)}`
          );

          promises.push(res);
        }

        const deleted = (await Promise.allSettled(promises)).filter(promise => promise.status === 'fulfilled');

        if (!deleted.length) {
          return send(interaction, { content: 'There was nothing to delete!', flags: 64 });
        }

        return send(interaction, { content: 'Successfully removed the given entries from the given allowlist' });
      }

      case 'list': {
        const allows = await this.rest.get<ApiGetFiltersInvitesAllowlistResult>(
          `/guilds/${interaction.guild_id}/filters/invites/allowlist`
        );

        if (!allows.length) {
          return send(interaction, { content: 'There is currently nothing on your allowlist' });
        }

        const content = allows.map(entry => `https://discord.gg/${entry.invite_code}`).join('\n');

        return send(interaction, {
          content: 'Here\'s your list',
          files: [{ name: 'allowlist.txt', content: Buffer.from(content) }]
        });
      }
    }
  }
}
