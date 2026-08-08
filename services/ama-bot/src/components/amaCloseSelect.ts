import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';

export default class AmaCloseSelectComponent implements ComponentHandler {
	public readonly name = 'ama-close-select';

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
				content: `**${session.title}** is already closed to new questions.`,
				components: [],
			});
			return;
		}

		await getContext().db`
			UPDATE ama_sessions SET ended = true WHERE id = ${session.id}
		`;

		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content: `Closed question submissions for **${session.title}**. Questions already submitted can still be reviewed and answered from the dashboard, and submissions can be reopened there.`,
			components: [],
		});
	}
}
