import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, UserPerms, send } from '#util';
import { HistoryCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { Case, makeHistoryEmbed } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { APIGuildInteraction } from 'discord-api-types/v8';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public parse(args: ArgumentsOf<typeof HistoryCommand>) {
    return {
      member: args.user,
      detailed: args.detailed
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof HistoryCommand>) {
    const { member, detailed: showDetails } = this.parse(args);

    const cases = await this.sql<Case[]>`SELECT * FROM cases WHERE guild_id = ${interaction.guild_id} AND target_id = ${member.user.id}`;

    const embed = makeHistoryEmbed({ user: member.user, cases, showDetails });
    return send(interaction, { embed });
  }
}
