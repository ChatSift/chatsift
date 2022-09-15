import { basename, extname } from 'node:path';
import type { Interaction } from '#util';

export type Component = {
	exec(message: Interaction, args: any): Promise<unknown> | unknown;
	name?: string;
};

export type ComponentInfo = {
	name: string;
};

export function componentInfo(path: string): ComponentInfo | null {
	if (extname(path) !== '.js') {
		return null;
	}

	return {
		name: basename(path, '.js'),
	};
}
