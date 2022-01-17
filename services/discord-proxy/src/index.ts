import 'reflect-metadata';
import { initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { Rest as DiscordRest } from '@cordis/rest';
import polka from 'polka';
import { jsonParser, sendBoom } from '@chatsift/rest-utils';
import { createServer } from 'http';
import { isBoom, Boom } from '@hapi/boom';

void (() => {
	const config = initConfig();
	const logger = createLogger('discord-proxy');

	const discordRest = new DiscordRest(config.discordToken);

	discordRest
		.on('response', async (req, res, rl) => {
			logger.trace({ rl }, `Finished request ${req.method!} ${req.path!}`);

			if (!res.ok) {
				logger.warn(
					{
						res: await res.json(),
						rl,
					},
					`Failed request ${req.method!} ${req.path!}`,
				);
			}
		})
		.on('ratelimit', (bucket, endpoint, prevented, waitingFor) => {
			logger.warn(
				{
					bucket,
					prevented,
					waitingFor,
				},
				`Hit a ratelimit on ${endpoint}`,
			);
		});

	const app = polka({
		onError(e, _, res) {
			res.setHeader('content-type', 'application/json');
			const boom = isBoom(e) ? e : new Boom(e);

			if (boom.output.statusCode === 500) {
				logger.error({ error: boom }, boom.message);
			}

			return sendBoom(boom, res);
		},
		server: createServer(),
	});

	app.use(jsonParser(), (req, res) => {
		logger.trace(`Received request ${req.method} ${req.path}`);

		return res.end();
	});

	app.listen(3003, () => logger.info('Listening for requests on port 3003'));
})();
