import { basename, extname } from 'node:path';

export type Command = {
	exec(message: any, args: any): any;
	name?: string;
};

export type CommandInfo = {
	name: string;
};

export const commandInfo = (path: string): CommandInfo | null => {
	if (extname(path) !== '.js') {
		return null;
	}

	return {
		name: basename(path, '.js'),
	};
};
