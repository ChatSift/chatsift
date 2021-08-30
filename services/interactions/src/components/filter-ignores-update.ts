import { FilterIgnoresStateStore, ChannelPaginationState, send } from '#util';
import type {
  ApiGetFiltersIgnoresChannelResult,
  ApiPatchFiltersIgnoresChannelBody,
  ApiPatchFiltersIgnoresChannelResult
} from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  APIButtonComponent,
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
    public readonly filterIgnoreState: FilterIgnoresStateStore
  ) {}

  public async exec(interaction: APIGuildInteraction, [filterType]: ['urls' | 'files' | 'invites' | 'words'], id: string) {
    void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

    const state = await this.filterIgnoreState.get(id) as ChannelPaginationState;

    const existing = await this.rest
      .get<ApiGetFiltersIgnoresChannelResult>(`/guilds/${interaction.guild_id}/filters/ignores/${state.channel!}`)
      .catch(() => null);

    const bitfield = new FilterIgnores(BigInt(existing?.value ?? '0'));
    const isOn = [bitfield.has('urls'), bitfield.has('files'), bitfield.has('invites'), bitfield.has('words')] as [boolean, boolean, boolean, boolean];

    const index = ({ urls: 0, files: 1, invites: 2, words: 3 } as const)[filterType];

    const currentlyOn = isOn[index];
    if (currentlyOn) {
      bitfield.remove(filterType);
      isOn[index] = false;
    } else {
      bitfield.add(filterType);
      isOn[index] = true;
    }

    const components = interaction.message!.components!;

    // Update the buttons with the current state
    const buttons = (components[2]!.components as APIButtonComponent[]);
    components[2]!.components = buttons.map((component, index) => {
      if (index !== buttons.length - 1) {
        component.style = isOn[index] ? ButtonStyle.Success : ButtonStyle.Danger;
      }

      return component;
    });

    await this.rest.patch<ApiPatchFiltersIgnoresChannelResult, ApiPatchFiltersIgnoresChannelBody>(
      `/guilds/${interaction.guild_id}/filters/ignores/${state.channel!}`, {
        value: bitfield.toJSON()
      }
    );

    void this.filterIgnoreState.set(id, state);

    return send(interaction, {
      content: 'Use the buttons to manage your ignore settings!',
      components
    }, InteractionResponseType.UpdateMessage);
  }
}
