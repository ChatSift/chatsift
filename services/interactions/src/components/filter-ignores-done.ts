import { FilterIgnoresStateStore, send } from '#util';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly filterIgnoreState: FilterIgnoresStateStore
  ) {}

  public async exec(interaction: APIGuildInteraction, []: [], id: string) {
    void this.filterIgnoreState.delete(id);

    return send(interaction, {
      content: 'Done, feel free to view your changes using `/filter config ignorelist`',
      components: []
    }, InteractionResponseType.UpdateMessage);
  }
}
