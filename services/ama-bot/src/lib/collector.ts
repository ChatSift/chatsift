import { setTimeout, clearTimeout } from 'node:timers';
import type { APIInteraction, APIModalSubmitInteraction } from '@discordjs/core';
import { GatewayDispatchEvents, InteractionType } from '@discordjs/core';
import { client } from './client.js';

export async function collectModal(id: string, waitFor: number): Promise<APIModalSubmitInteraction> {
	return new Promise<APIModalSubmitInteraction>((resolve, reject) => {
		const cleanup = () => {
			/* eslint-disable @typescript-eslint/no-use-before-define */
			client.off(GatewayDispatchEvents.InteractionCreate, handler);
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

		client.on(GatewayDispatchEvents.InteractionCreate, handler);
	});
}
