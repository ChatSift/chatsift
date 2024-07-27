import type { APIModalSubmission, ModalSubmitComponent } from '@discordjs/core';

export function computeModalFields(data: APIModalSubmission) {
	return data.components.reduce((accumulator, next) => {
		for (const component of next.components) {
			accumulator.set(component.custom_id, component);
		}

		return accumulator;
	}, new Map<string, ModalSubmitComponent>());
}
