import { LogIgnoresStateStore, ChannelPaginationState, send } from '#util';
import type { ApiGetGuildLogIgnoresResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, APIButtonComponent, InteractionResponseType, ButtonStyle } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly logIgnoresStore: LogIgnoresStateStore,
	) {}

	public async exec(interaction: APIGuildInteraction, []: [], id: string) {
		void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

		const state = (await this.logIgnoresStore.get(id)) as ChannelPaginationState;

		const ignores = await this.rest.get<ApiGetGuildLogIgnoresResult>(
			`/guilds/${interaction.guild_id}/settings/log-ignores`,
		);
		const ignore = !ignores.find((ignore) => ignore.channel_id === state.channel!);

		const components = interaction.message!.components!;

		// Update the buttons with the current state
		const button = (components[2]!.components as [APIButtonComponent, APIButtonComponent])[0];
		button.style = ignore ? ButtonStyle.Success : ButtonStyle.Danger;

		if (ignore) {
			await this.rest.put(`/guilds/${interaction.guild_id}/settings/log-ignores/${state.channel!}`);
		} else {
			await this.rest.delete(`/guilds/${interaction.guild_id}/settings/log-ignores/${state.channel!}`);
		}

		void this.logIgnoresStore.set(id, state);

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
