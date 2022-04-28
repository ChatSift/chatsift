import { basename, extname } from 'path';

export interface Command {
	name?: string;
	exec: (message: any, args: any) => any;
}

export interface CommandInfo {
	name: string;
}

export const commandInfo = (path: string): CommandInfo | null => {
	if (extname(path) !== '.js') {
		return null;
	}

	return {
		name: basename(path, '.js'),
	};
};
