import { send } from '#util';
import type { ApiGetGuildsAssignablesResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  InteractionResponseType,
  RESTPatchAPIGuildMemberJSONBody,
  Routes,
  Snowflake
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public async exec(interaction: APIGuildInteraction, [roleId]: [string]) {
    void send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

    const selfAssignables = new Set<Snowflake>(
      await this.rest
        .get<ApiGetGuildsAssignablesResult>(`/guilds/${interaction.guild_id}/assignables`)
        .then(
          rows => rows.map(
            row => row.role_id
          )
        )
    );

    if (!selfAssignables.has(roleId)) {
      return send(interaction, {
        content: 'It seems that role is no longer self assignable. Please ask an admin to update this prompt.'
      });
    }

    const roles = new Set(interaction.member.roles);
    const add = !roles.has(roleId);

    if (add) {
      roles.add(roleId);
    } else {
      roles.delete(roleId);
    }

    await this.discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(
      Routes.guildMember(interaction.guild_id, interaction.member.user.id), {
        data: { roles: [...roles] },
        reason: 'Self-assignable roles update'
      }
    );

    return send(interaction, { content: `Successfully ${add ? 'added' : 'removed'} the given role to you` });
  }
}
