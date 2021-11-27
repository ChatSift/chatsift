import { LogIgnoresStateStore, ChannelPaginationState, send } from '#util';
import type { ApiGetGuildLogIgnoresResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  APISelectMenuComponent,
  APIButtonComponent,
  APIMessageSelectMenuInteractionData,
  InteractionResponseType,
  ButtonStyle
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly logIgnoresStore: LogIgnoresStateStore
  ) {}

  public async exec(interaction: APIGuildInteraction, []: [], id: string) {
    void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

    const data = interaction.data as APIMessageSelectMenuInteractionData;
    const selection = data.values[0]!;

    const state = await this.logIgnoresStore.get(id) as ChannelPaginationState;
    state.channel = selection;

    const ignores = await this.rest.get<ApiGetGuildLogIgnoresResult>(`/guilds/${interaction.guild_id}/settings/log-ignores`);
    const ignore = ignores.find(ignore => ignore.channel_id === selection);

    const components = interaction.message!.components!;

    // Set the channel as the "default" in the select menu
    const selectMenu = components[0]!.components[0] as APISelectMenuComponent;
    const selectionIndex = selectMenu.options!.findIndex(option => option.value === selection);
    selectMenu.options = selectMenu.options!.map((option, index) => {
      option.default = index === selectionIndex;
      return option;
    });

    // Update the buttons with the current state
    const button = (components[2]!.components as [APIButtonComponent, APIButtonComponent])[0];
    button.disabled = false;
    button.style = ignore ? ButtonStyle.Success : ButtonStyle.Danger;

    void this.logIgnoresStore.set(id, state);

    return send(interaction, {
      content: 'Use the buttons to manage your ignore settings!',
      components
    }, InteractionResponseType.UpdateMessage);
  }
}
