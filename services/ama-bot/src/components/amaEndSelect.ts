import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';
import type { ComponentHandler } from '../lib/components.js';

export default class AmaEndSelectComponent implements ComponentHandler {
	public readonly name = 'ama-end-select';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, _logger: Logger) {
		const [rawId] = (interaction.data as APIMessageStringSelectInteractionData).values;
		const amaId = Number.parseInt(rawId!, 10);

		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const [session] = await getContext().db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE id = ${amaId}
		`;

		if (!session || session.guildId !== interaction.guild_id) {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'That AMA could not be found.',
				components: [],
			});
			return;
		}

		if (session.ended) {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `**${session.title}** has already ended.`,
				components: [],
			});
			return;
		}

		await getContext().db`
			UPDATE ama_sessions SET ended = true WHERE id = ${session.id}
		`;

		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content: `Ended **${session.title}**. It will no longer accept new questions.`,
			components: [],
		});
	}
}
