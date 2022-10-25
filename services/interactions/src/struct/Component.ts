import { basename, extname } from 'node:path';
import type { Awaitable } from '@automoderator/common';
import type { APIMessageComponentGuildInteraction } from 'discord-api-types/v10';

export type ComponentInfo = {
	name: string;
};

export type Component<Type extends APIMessageComponentGuildInteraction = APIMessageComponentGuildInteraction> = {
	handle(interaction: Type, ...args: any[]): Awaitable<unknown>;
	readonly name?: string;
};

export type ComponentConstructor = new (...args: any[]) => Component;

export function getComponentInfo(path: string): ComponentInfo | null {
	if (extname(path) !== '.js') {
		return null;
	}

	return {
		name: basename(path, '.js'),
	};
}
