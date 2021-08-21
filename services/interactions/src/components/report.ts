import { send } from '#util';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  InteractionResponseType,
  APIButtonComponent,
  ComponentType
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public exec(interaction: APIGuildInteraction, [action]: [string]) {
    const [
      review,
      actioned,
      acknowledged
    ] = interaction.message!.components![0]!.components as [APIButtonComponent, APIButtonComponent, APIButtonComponent];
    const [embed] = interaction.message!.embeds;

    if (action === 'action') {
      actioned.disabled = true;
    } else if (action === 'acknowledge') {
      acknowledged.disabled = true;
    }

    return send(interaction, {
      components: [
        {
          type: ComponentType.ActionRow,
          components: [review, actioned, acknowledged]
        }
      ],
      embed: embed
        ? { ...embed, color: 2895667 }
        : undefined
    }, InteractionResponseType.UpdateMessage);
  }
}
