import { FilterIgnoresStateStore, send, EMOTES } from '#util';
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
	Routes,
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';
import { sortChannels } from '@automoderator/core';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly filterIgnoreState: FilterIgnoresStateStore,
	) {}

	public async exec(interaction: APIGuildInteraction, [directon]: ['back' | 'forward'], id: string) {
		void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

		const state = (await this.filterIgnoreState.get(id))!;

		if (directon === 'back') {
			state.page--;
		} else {
			state.page++;
		}

		const channels = await this.discordRest.get<RESTGetAPIGuildChannelsResult>(
			Routes.guildChannels(interaction.guild_id),
		);
		const components = interaction.message!.components!;

		// There's no longer a selected channel as the page was switched
		const selectMenu = components[0]!.components[0] as APISelectMenuComponent;
		selectMenu.options = sortChannels(
			channels.filter(
				(channel) => channel.type === ChannelType.GuildCategory || channel.type === ChannelType.GuildText,
			),
		)
			.map(
				(channel): APISelectMenuOption => ({
					label: ellipsis(channel.name!, 25),
					emoji: channel.type === ChannelType.GuildText ? EMOTES.TEXT_CHANNEL : EMOTES.CATEGORY_CHANNEL,
					value: channel.id,
				}),
			)
			.slice(state.page * 25, state.page * 25 + 25);

		// Update the pagination buttons
		const [pageLeft, , pageRight] = components[1]!.components as [
			APIButtonComponent,
			APIButtonComponent,
			APIButtonComponent,
		];
		if (state.page === 0) {
			pageLeft.disabled = true;
			pageRight.disabled = false;
		} else if (state.page === state.maxPages - 1) {
			pageLeft.disabled = false;
			pageRight.disabled = true;
		} else {
			pageLeft.disabled = false;
			pageRight.disabled = false;
		}

		const update = (component: APIButtonComponent) => {
			component.disabled = true;
			component.style = ButtonStyle.Danger;

			return component;
		};

		// Re-disable buttons
		components[2]!.components = (components[2]!.components as APIButtonComponent[]).map(update);
		components[3]!.components = (components[3]!.components as APIButtonComponent[]).map(update);

		void this.filterIgnoreState.set(id, state);

		return send(
			interaction,
			{
				content: 'Please select a channel...',
				components,
			},
			InteractionResponseType.UpdateMessage,
		);
	}
}
