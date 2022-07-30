import 'reflect-metadata';
import type { DiscordEvents } from '@automoderator/broker-types';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { GatewayDispatchEvents } from 'discord-api-types/v9';
import Redis from 'ioredis';
import polka from 'polka';
import { container } from 'tsyringe';
import { WebhookRoute } from './routes/discordWebhook';
import { kGatewayBroadcasts } from './util';
import { Handler } from '#handler';

void (async () => {
	const config = initConfig();
	const logger = createLogger('interactions');

	const discordRest = new DiscordRest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
		abortAfter: 20e3,
	}).on('abort', (req) => {
		logger.warn({ req }, `Aborted request ${req.method!} ${req.path!}`);
	});

	const { channel } = await createAmqp(config.amqpUrl);
	const logs = new PubSubPublisher(channel);
	const gateway = new RoutingSubscriber<keyof DiscordEvents, DiscordEvents>(channel);
	const gatewayBroadcasts = new PubSubPublisher(channel);

	await logs.init({ name: 'guild_logs', fanout: false });
	// No queue specified means these packets are fanned out
	await gateway.init({
		name: 'gateway',
		keys: [GatewayDispatchEvents.GuildMembersChunk],
	});
	await gatewayBroadcasts.init({ name: 'gateway_broadcasts', fanout: true });

	container.register(PubSubPublisher, { useValue: logs });
	container.register(RoutingSubscriber, { useValue: gateway });
	container.register(kGatewayBroadcasts, { useValue: gatewayBroadcasts });
	container.register(DiscordRest, { useValue: discordRest });
	container.register(kLogger, { useValue: logger });
	container.register(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	await container.resolve(Handler).init();

	const app = polka();

	const webhookRoute = container.resolve(WebhookRoute);
	webhookRoute.register(app);

	app.listen(3002, () => logger.info('Listening for interactions on port 3002'));
})();
