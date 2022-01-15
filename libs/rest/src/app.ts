import { Config, kConfig } from '@automoderator/injection';
import cors from 'cors';
import helmet from 'helmet';
import polka from 'polka';
import { container } from 'tsyringe';
import { attachHttpUtils } from './middleware';
import { getPolkaOptions } from './utils';

export const createApp = () => {
	const config = container.resolve<Config>(kConfig);

	return polka(getPolkaOptions()).use(
		cors({
			origin: config.cors,
			credentials: true,
		}),
		helmet({ contentSecurityPolicy: config.nodeEnv === 'prod' ? undefined : false }) as any,
		attachHttpUtils(),
	);
};
