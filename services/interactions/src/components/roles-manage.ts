import { inject, injectable } from 'tsyringe';
import { Component } from '../component';
import { send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@cordis/rest';
import { kSql } from '@automoderator/injection';
import { stripIndents } from 'common-tags';
import {
  APIGuildInteraction,
  APIMessageSelectMenuInteractionData,
  InteractionResponseType,
  RESTPatchAPIGuildMemberJSONBody,
  Routes,
  Snowflake
} from 'discord-api-types/v9';
import type { SelfAssignableRole } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Component {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async exec(interaction: APIGuildInteraction) {
    await send(interaction, {}, { type: InteractionResponseType.DeferredMessageUpdate });

    const selfAssignables = new Set<Snowflake>(
      await this
        .sql<Pick<SelfAssignableRole, 'role_id'>[]>`SELECT role_id FROM self_assignable_roles WHERE guild_id = ${interaction.guild_id}`
        .then(
          rows => rows.map(
            row => row.role_id
          )
        )
    );

    const roles = new Set(interaction.member.roles);

    const added: string[] = [];
    const removed: string[] = [];

    const selected = new Set((interaction.data as APIMessageSelectMenuInteractionData).values as Snowflake[]);

    for (const role of roles) {
      if (selfAssignables.has(role) && !selected.has(role)) {
        roles.delete(role);
        removed.push(`<@&${role}>`);
      }
    }

    for (const role of selected) {
      if (!roles.has(role)) {
        roles.add(role);
        added.push(`<@&${role}>`);
      }
    }

    await this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(interaction.guild_id, interaction.member.user.id), {
      data: { roles: [...roles] },
      reason: 'Self-assignable roles update'
    });

    return send(interaction, {
      content: added.length || removed.length
        ? stripIndents`
          Succesfully updated your roles:
          ${added.length ? `• added: ${added.join(', ')}\n` : ''}${removed.length ? `• removed: ${removed.join(', ')}` : ''}
        `
        : 'There was nothing to update!',
      components: []
    }, { update: true });
  }
}
