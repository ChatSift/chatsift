import { FilterIgnoresStateStore, ChannelPaginationState, send } from '#util';
import { ellipsis } from '@automoderator/util';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  RESTGetAPIGuildChannelsResult,
  APIGuildInteraction,
  APISelectMenuOption,
  APISelectMenuComponent,
  APIButtonComponent,
  InteractionResponseType,
  ButtonStyle,
  ChannelType,
  Routes
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly filterIgnoreState: FilterIgnoresStateStore
  ) {}

  public async exec(interaction: APIGuildInteraction, [directon]: ['back' | 'forward'], id: string) {
    void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

    const state = await this.filterIgnoreState.get(id) as ChannelPaginationState;

    if (directon === 'back') {
      state.page--;
    } else {
      state.page++;
    }

    const channels = await this.discordRest.get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id));
    const components = interaction.message!.components!;

    // There's no longer a selected channel as the page was switched
    const selectMenu = components[0]!.components[0] as APISelectMenuComponent;
    selectMenu.options = channels
      .filter(channel => channel.type === ChannelType.GuildCategory || channel.type === ChannelType.GuildText)
      .map((channel): APISelectMenuOption => ({
        label: ellipsis(channel.name!, 25),
        emoji: channel.type === ChannelType.GuildText
          ? {
            id: '779036156175188001',
            name: 'ChannelText',
            animated: false
          }
          : {
            id: '816771723264393236',
            name: 'ChannelCategory',
            animated: false
          },
        value: channel.id
      }))
      .slice(state.page * 25, (state.page * 25) + 25);

    // Update the pagination buttons
    const [pageLeft,, pageRight] = components[1]!.components as [APIButtonComponent, APIButtonComponent, APIButtonComponent];
    if (state.page === 0) {
      pageLeft.disabled = true;
      pageRight.disabled = false;
    } else if (state.page === state.maxPages - 1) {
      pageLeft.disabled = false;
      pageRight.disabled = true;
    } else {
      pageLeft.disabled = false;
      pageRight.disabled;
    }

    // Re-disable buttons
    const buttons = (components[2]!.components as APIButtonComponent[]);
    components[2]!.components = buttons.map((component, index) => {
      if (index !== buttons.length - 1) {
        component.disabled = true;
        component.style = ButtonStyle.Danger;
      }

      return component;
    });

    void this.filterIgnoreState.set(id, state);

    return send(interaction, {
      content: 'Please select a channel...',
      components
    }, InteractionResponseType.UpdateMessage);
  }
}
