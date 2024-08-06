import type { BotId } from '@chatsift/shared';

export interface MakeOptions {
	readonly path: `/${string}`;
	readonly queryKey: readonly [string, ...string[]];
}

interface Info {
	readonly [Key: string]: Info | MakeOptions | ((...params: any[]) => MakeOptions);
}

export const routesInfo = {
	me: {
		queryKey: ['userMe'],
		path: '/auth/discord/@me',
	},
	bots: {
		queryKey: ['bots'],
		path: '/bots',
		bot: (bot: BotId) =>
			({
				queryKey: ['bots', bot],
				path: `/bots/${bot}`,
			}) as const,
	},
} as const satisfies Info;
