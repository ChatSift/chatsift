import { FilterIgnoresStateStore, send } from '#util';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(public readonly filterIgnoreState: FilterIgnoresStateStore) {}

	public async exec(interaction: APIGuildInteraction, []: [], id: string) {
		void this.filterIgnoreState.delete(id);

		return send(
			interaction,
			{
				content: 'Done, feel free to view your changes using `/config-automod-ignores show`',
				components: [],
			},
			InteractionResponseType.UpdateMessage,
		);
	}
}
