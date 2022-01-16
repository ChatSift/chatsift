import { kLogger } from '@automoderator/injection';
import type { RecursiveReaddirStream } from '@chatsift/readdir';
import type { Logger } from 'pino';
import type { Polka } from 'polka';
import { container, InjectionToken } from 'tsyringe';
import { Route } from './route';

export const initApp = async (app: Polka, files: RecursiveReaddirStream) => {
	const logger = container.resolve<Logger>(kLogger);

	for await (const file of files) {
		const info = Route.pathToRouteInfo(file.split('/routes').pop()!);
		if (!info) {
			logger.debug(`Hit path with no info: "${file}"`);
			continue;
		}

		const route = container.resolve<Route>(((await import(file)) as { default: InjectionToken<Route> }).default);
		route.register(info, app);
	}
};
