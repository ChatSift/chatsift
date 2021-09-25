import { send } from '#util';
import { Rest } from '@automoderator/http-client';
import { kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIEmbed,
  APIGuildMember,
  APIGuildInteraction,
  InteractionResponseType,
  APIButtonComponent,
  ComponentType,
  RESTPatchAPIGuildMemberJSONBody,
  Routes
} from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private async _filter(guildId: string, userId: string, embed?: APIEmbed) {
    const words = embed?.footer?.text.split(': ')[1]?.split(', ') ?? [];
    const member = await this.discordRest.get<APIGuildMember>(Routes.guildMember(guildId, userId)).catch(() => null);

    if (!words.length || !member) {
      return;
    }

    let name = member.nick ?? member.user!.username;
    for (const word of words) {
      name = name.replace(new RegExp(word, 'gi'), '');
    }

    await this.discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(guildId, userId), {
      data: {
        nick: name
      }
    });
  }

  public async exec(interaction: APIGuildInteraction, [action, userId]: [string, string]) {
    const [
      filter,
      actioned,
      acknowledged
    ] = interaction.message!.components![0]!.components as [APIButtonComponent, APIButtonComponent, APIButtonComponent];
    const [embed] = interaction.message!.embeds;

    if (action === 'filter') {
      filter.disabled = true;
      void this._filter(interaction.guild_id, userId, embed);
    } else if (action === 'action') {
      actioned.disabled = true;
    } else if (action === 'acknowledge') {
      acknowledged.disabled = true;
    }

    return send(interaction, {
      components: [
        {
          type: ComponentType.ActionRow,
          components: [filter, actioned, acknowledged]
        }
      ],
      embed: embed
        ? { ...embed, color: 2895667 }
        : undefined
    }, InteractionResponseType.UpdateMessage);
  }
}
