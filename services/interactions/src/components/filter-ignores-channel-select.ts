import { FilterIgnoresStateStore, send } from '#util';
import type { ApiGetFiltersIgnoresChannelResult } from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@chatsift/api-wrapper';
import { Rest as DiscordRest } from '@cordis/rest';
import {
	APIGuildInteraction,
	APISelectMenuComponent,
	APIButtonComponent,
	APIMessageSelectMenuInteractionData,
	InteractionResponseType,
	ButtonStyle,
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly filterIgnoreState: FilterIgnoresStateStore,
	) {}

	public async exec(interaction: APIGuildInteraction, []: [], id: string) {
		void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

		const data = interaction.data as APIMessageSelectMenuInteractionData;
		const selection = data.values[0]!;

		const existing = await this.rest
			.get<ApiGetFiltersIgnoresChannelResult>(`/guilds/${interaction.guild_id}/filters/ignores/${selection}`)
			.catch(() => null);

		const bitfield = new FilterIgnores(BigInt(existing?.value ?? '0'));
		const isOn = [
			bitfield.has('urls'),
			bitfield.has('files'),
			bitfield.has('invites'),
			bitfield.has('words'),
			bitfield.has('global'),
			bitfield.has('automod'),
		];

		const state = (await this.filterIgnoreState.get(id))!;
		state.channel = selection;

		const components = interaction.message!.components!;

		// Set the channel as the "default" in the select menu
		const selectMenu = components[0]!.components[0] as APISelectMenuComponent;
		const selectionIndex = selectMenu.options.findIndex((option) => option.value === selection);
		selectMenu.options = selectMenu.options.map((option, index) => {
			option.default = index === selectionIndex;
			return option;
		});

		const update =
			(offset = 0) =>
			(component: APIButtonComponent, index: number) => {
				component.disabled = false;
				component.style = isOn[index + offset] ? ButtonStyle.Success : ButtonStyle.Danger;

				return component;
			};

		// Update the buttons with the current state
		components[2]!.components = (components[2]!.components as APIButtonComponent[]).map(update());
		components[3]!.components = (components[3]!.components as APIButtonComponent[]).map(update(3));

		void this.filterIgnoreState.set(id, state);

		return send(
			interaction,
			{
				content: 'Use the buttons to manage your ignore settings!',
				components,
			},
			InteractionResponseType.UpdateMessage,
		);
	}
}
