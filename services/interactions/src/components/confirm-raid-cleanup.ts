import { RaidCleanupMembersStore, send } from '#util';
import { ApiPostGuildsCasesBody, CaseAction } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { kSql } from '@automoderator/injection';
import { APIGuildInteraction, InteractionResponseType, Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly raidCleanupMembers: RaidCleanupMembersStore,
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async exec(interaction: APIGuildInteraction, [action]: [string], id: string) {
    void send(interaction, { components: [] }, InteractionResponseType.UpdateMessage);

    const members = (await this.raidCleanupMembers.get(id))!;
    void this.raidCleanupMembers.delete(id);

    if (action === 'n') {
      return send(interaction, { content: 'Canceled raid cleanup' }, InteractionResponseType.ChannelMessageWithSource, true);
    }

    const promises: Promise<void>[] = [];
    const sweeped: Snowflake[] = [];
    const missed: Snowflake[] = [];

    let index = 0;

    for (const { id: targetId, tag: targetTag } of members) {
      promises.push(
        this.rest.post<unknown, ApiPostGuildsCasesBody>(`/guilds/${interaction.guild_id}/cases`, [
          {
            action: CaseAction.ban,
            mod_id: interaction.member.user.id,
            mod_tag: `${interaction.member.user.username}#${interaction.member.user.discriminator}`,
            target_id: targetId,
            target_tag: targetTag,
            reason: `Raid cleanup (${++index}/${members.length})`,
            created_at: new Date(),
            execute: true
          }
        ])
          .then(() => void sweeped.push())
          .catch(() => void missed.push())
      );
    }

    await Promise.allSettled(promises);

    const format = (xs: Snowflake[]) => xs
      .map(x => `• <@${x}>`)
      .join('\n');

    return send(interaction, {
      content: `Done cleaning up! Here's a summary:\n\n**Members sweeped**:${format(sweeped)}\n\n**Members missed**:${format(missed)}`,
      allowed_mentions: { parse: [] }
    },
    InteractionResponseType.ChannelMessageWithSource,
    true);
  }
}
