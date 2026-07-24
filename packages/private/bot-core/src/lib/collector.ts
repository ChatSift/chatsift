import { setTimeout, clearTimeout } from 'node:timers';
import { getContext } from '@chatsift/backend-core';
import type { APIInteraction, APIModalSubmitInteraction } from '@discordjs/core';
import { GatewayDispatchEvents, InteractionType } from '@discordjs/core';

export async function collectModal(id: string, waitFor: number): Promise<APIModalSubmitInteraction> {
	return new Promise<APIModalSubmitInteraction>((resolve, reject) => {
		const cleanup = () => {
			/* eslint-disable @typescript-eslint/no-use-before-define */
			getContext().service.client.off(GatewayDispatchEvents.InteractionCreate, handler);
			clearTimeout(timeout);
			/* eslint-enable @typescript-eslint/no-use-before-define */
		};

		const handler = ({ data: interaction }: { data: APIInteraction }) => {
			if (interaction.type === InteractionType.ModalSubmit && interaction.data.custom_id === id) {
				resolve(interaction);
				cleanup();
			}
		};

		const timeout = setTimeout(() => {
			reject(new Error('Modal submission timed out'));
			cleanup();
		}, waitFor).unref();

		getContext().service.client.on(GatewayDispatchEvents.InteractionCreate, handler);
	});
}
