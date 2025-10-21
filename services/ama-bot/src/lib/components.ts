import { glob } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RedisStore } from '@chatsift/backend-core';
import { getContext, isModuleWithDefault } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';

export interface ComponentHandler<State = never> {
	handle(interaction: APIMessageComponentInteraction, state: State): Promise<void>;
	readonly name: string;
	readonly stateStore: RedisStore<State> | null;
}

type ComponentHandlerConstructor<State> = new () => ComponentHandler<State>;

function isComponentHandlerConstructor(input: unknown): input is ComponentHandlerConstructor<any> {
	return typeof input === 'function' && input.length === 0 && 'handle' in input.prototype;
}

const components = new Map<string, ComponentHandler<any>>();

export async function registerHandlers(): Promise<void> {
	const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'components');
	const files = glob(`${path}/**/*.js`);

	for await (const file of files) {
		const mod = await import(file);
		if (!isModuleWithDefault(mod, isComponentHandlerConstructor)) {
			getContext().logger.warn({ file }, 'Skipped invalid component handler module');
			continue;
		}

		const handler = new mod.default();
		components.set(handler.name, handler);
		getContext().logger.info({ component: handler.name }, 'Registered component handler');
	}
}

export async function handleComponentInteraction(interaction: APIMessageComponentInteraction): Promise<void> {
	const [componentName, stateId] = interaction.data.custom_id.split(':') as [string, string?];

	const handler = components.get(componentName);
	if (!handler) {
		getContext().logger.warn({ componentName }, 'No handler found for component interaction');
		return;
	}

	if (handler.stateStore && !stateId) {
		getContext().logger.warn({ componentName }, 'State ID missing for component interaction requiring state');
		return;
	}

	if (!handler.stateStore && stateId) {
		getContext().logger.warn({ componentName }, 'Unexpected State ID for component interaction not requiring state');
		return;
	}

	const state = stateId ? await handler.stateStore?.get(stateId) : undefined;
	await handler.handle(interaction, state);
}
