import { inject, singleton } from 'tsyringe';
import { Command } from '../../../../command';
import { ArgumentsOf, send } from '#util';
import { FilterCommand } from '#interactions';
import { kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { Rest } from '@automoderator/http-client';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import type { AllowedInvite } from '@automoderator/core';

@singleton()
export class InvitesConfig implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private cleanInvite(invite: string) {
    return invite
      .replace(/(https?:\/\/)?(discord\.gg\/?)?/g, '')
      .replace(/ +/g, '');
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['invites']) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'allow': {
        const data: AllowedInvite[] = args.allow.entries
          .split(',')
          .map(entry => ({ guild_id: interaction.guild_id, invite_code: this.cleanInvite(entry) }));

        const added = await this.sql`INSERT INTO allowed_invites ${this.sql(data)} ON CONFLICT DO NOTHING RETURNING *`;

        if (!added.length) {
          return send(interaction, { content: 'There was nothing to add!', flags: 64 });
        }

        return send(interaction, { content: 'Successfully added the given entries to the allowlist' });
      }

      case 'unallow': {
        const entries = args.unallow.entries.split(',').map(entry => this.cleanInvite(entry));
        const deleted = await this.sql`DELETE FROM allowed_invites WHERE invite_code = ANY(${this.sql.array(entries)}) RETURNING *`;

        if (!deleted.length) {
          return send(interaction, { content: 'There was nothing to delete!', flags: 64 });
        }

        return send(interaction, { content: 'Successfully removed the given entries from the given allowlist' });
      }

      case 'list': {
        const allows = await this.sql<AllowedInvite[]>`SELECT * FROM allowed_invites WHERE guild_id = ${interaction.guild_id}`;

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
