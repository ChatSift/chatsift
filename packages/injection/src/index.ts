import { container } from 'tsyringe';

export const kConfig = Symbol('config');

export const kRedis = Symbol('IORedis instance');

export const kLogger = Symbol('logger instance');

export interface Config {
	amqpUrl: string;
	rootDomain: string;
	dashDomain: string;
	ghostDomain: string;
	discordClientId: string;
	devIds: string[];
	interactionsTestGuilds: string[];
	discordClientSecret: string;
	discordToken: string;
	discordPubKey: string;
	discordScopes: string;
	dbUrl: string;
	redisUrl: string;
	nodeEnv: string;
	encryptionKey: string;
	cors: string | string[];
	nsfwPredictApiKey: string;
	ghostIntegrationKey: string;
	discordProxyUrl: string;
}

export const initConfig = () => {
	const config: Config = {
		amqpUrl: process.env.AMQP_URL!,
		rootDomain: process.env.ROOT_DOMAIN!,
		dashDomain: process.env.DASH_DOMAIN!,
		ghostDomain: process.env.GHOST_DOMAIN!,
		discordClientId: process.env.DISCORD_CLIENT_ID!,
		devIds: process.env.DEV_IDS?.split(',') ?? [],
		interactionsTestGuilds: process.env.INTERACTIONS_TEST_GUILDS?.split(',') ?? [],
		discordClientSecret: process.env.DISCORD_CLIENT_SECRET!,
		discordToken: process.env.DISCORD_TOKEN!,
		discordPubKey: process.env.DISCORD_PUB_KEY!,
		discordScopes: process.env.DISCORD_SCOPES?.split(',').join(' ') ?? '',
		dbUrl: process.env.DB_URL!,
		redisUrl: process.env.REDIS_URL!,
		nodeEnv: process.env.NODE_ENV ?? 'dev',
		encryptionKey: process.env.ENCRYPTION_KEY!,
		cors: process.env.CORS?.split(',') ?? '*',
		nsfwPredictApiKey: process.env.NSFW_PREDICT_API_KEY!,
		ghostIntegrationKey: process.env.GHOST_INTEGRATION_KEY!,
		discordProxyUrl: process.env.DISCORD_PROXY_URL!,
	};

	container.register<Config>(kConfig, { useValue: config });
	return config;
};
