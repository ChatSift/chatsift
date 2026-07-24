import { glob } from 'node:fs/promises';
import type { Logger, RedisStore } from '@chatsift/backend-core';
import { getContext, isModuleWithDefault } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';

export interface ComponentHandler<State = never> {
	handle(interaction: APIMessageComponentInteraction, state: State, logger: Logger): Promise<void>;
	readonly name: string;
	readonly stateStore: RedisStore<State> | null;
}

type ComponentHandlerConstructor<State> = new () => ComponentHandler<State>;

function isComponentHandlerConstructor(input: unknown): input is ComponentHandlerConstructor<any> {
	return typeof input === 'function' && input.length === 0 && 'handle' in input.prototype;
}

const components = new Map<string, ComponentHandler<any>>();

export function registerComponentHandler(handler: ComponentHandler<any>): void {
	components.set(handler.name, handler);
	getContext().logger.info({ component: handler.name }, 'Registered component handler');
}

/**
 * Globs `${componentsDir}/**\/*.js`, dynamically imports each module, and registers every valid default-exported
 * `ComponentHandler` constructor. Callers pass their own service-local components directory, since this package
 * has no `components/` of its own.
 */
export async function registerComponentHandlers(componentsDir: string): Promise<void> {
	const files = glob(`${componentsDir}/**/*.js`);

	for await (const file of files) {
		const mod = await import(file);
		if (!isModuleWithDefault(mod, isComponentHandlerConstructor)) {
			getContext().logger.warn({ file }, 'Skipped invalid component handler module');
			continue;
		}

		registerComponentHandler(new mod.default());
	}
}

export async function handleComponentInteraction(
	interaction: APIMessageComponentInteraction,
	logger: Logger,
): Promise<void> {
	const [componentName, stateId] = interaction.data.custom_id.split(':') as [string, string?];

	const handler = components.get(componentName);
	if (!handler) {
		logger.warn({ componentName }, 'No handler found for component interaction');
		return;
	}

	if (handler.stateStore && !stateId) {
		logger.warn({ componentName }, 'State ID missing for component interaction requiring state');
		return;
	}

	// Handlers with a Redis-backed stateStore resolve `stateId` into the stored value. Handlers without one
	// (stateStore: null) get the raw stateId string straight off the custom_id, e.g. an embedded row ID.
	const state = stateId ? (handler.stateStore ? await handler.stateStore.get(stateId) : stateId) : undefined;
	await handler.handle(interaction, state, logger);
}
