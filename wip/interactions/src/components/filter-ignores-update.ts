import { FilterIgnoresStateStore, send } from '#util';
import type {
	ApiGetFiltersIgnoresChannelResult,
	ApiPatchFiltersIgnoresChannelBody,
	ApiPatchFiltersIgnoresChannelResult,
} from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@chatsift/api-wrapper';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, APIButtonComponent, InteractionResponseType, ButtonStyle } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly filterIgnoreState: FilterIgnoresStateStore,
	) {}

	public async exec(
		interaction: APIGuildInteraction,
		[filterType]: ['urls' | 'files' | 'invites' | 'words' | 'global' | 'automod'],
		id: string,
	) {
		void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

		const state = (await this.filterIgnoreState.get(id))!;

		const existing = await this.rest
			.get<ApiGetFiltersIgnoresChannelResult>(`/guilds/${interaction.guild_id}/filters/ignores/${state.channel!}`)
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

		const index = ({ urls: 0, files: 1, invites: 2, words: 3, global: 4, automod: 5 } as const)[filterType];

		const currentlyOn = isOn[index];
		if (currentlyOn) {
			bitfield.remove(filterType);
			isOn[index] = false;
		} else {
			bitfield.add(filterType);
			isOn[index] = true;
		}

		const components = interaction.message!.components!;

		const update =
			(offset = 0) =>
			(component: APIButtonComponent, index: number) => {
				component.style = isOn[index + offset] ? ButtonStyle.Success : ButtonStyle.Danger;
				return component;
			};

		// Update the buttons with the current state
		components[2]!.components = (components[2]!.components as APIButtonComponent[]).map(update(0));
		components[3]!.components = (components[3]!.components as APIButtonComponent[]).map(update(3));

		await this.rest.patch<ApiPatchFiltersIgnoresChannelResult, ApiPatchFiltersIgnoresChannelBody>(
			`/guilds/${interaction.guild_id}/filters/ignores/${state.channel!}`,
			{
				value: bitfield.toJSON(),
			},
		);

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
