import { inject, injectable } from 'tsyringe';
import { Component } from '../component';
import { HTTPError, Rest } from '@automoderator/http-client';
import { kSql } from '@automoderator/injection';
import { send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import type { Sql } from 'postgres';

@injectable()
export default class implements Component {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async exec(interaction: APIGuildInteraction, [csId, action]: [string, string]) {
    if (action === 'n') {
      return send(interaction, {
        content: 'Okay, I won\'t delete the case',
        components: []
      }, { type: InteractionResponseType.UpdateMessage });
    }

    try {
      await this.rest.delete(`/api/v1/guilds/${interaction.guild_id}/cases/${csId}`);
      return send(interaction, {
        content: 'Successfully deleted the case',
        components: []
      }, { type: InteractionResponseType.UpdateMessage });
    } catch (e) {
      if (!(e instanceof HTTPError)) {
        throw e;
      }

      switch (e.statusCode) {
        case 404: {
          return send(interaction, {
            content: 'Looks like that case has already been deleted',
            components: []
          }, { type: InteractionResponseType.UpdateMessage });
        }

        default: {
          throw e;
        }
      }
    }
  }
}
