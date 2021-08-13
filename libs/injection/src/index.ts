import { container } from 'tsyringe';

export const kConfig = Symbol('config');

export const kSql = Symbol('postgres instance');

export const kLogger = Symbol('logger instance');

export interface Config {
  amqpUrl: string;
  rootDomain: string;
  authDomain: string;
  apiDomain: string;
  dashDomain: string;
  internalApiToken: string;
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
  elasticUrl: string;
  elasticUsername: string;
  elasticPassword: string;
}

export const initConfig = () => {
  const config: Config = {
    amqpUrl: process.env.AMQP_URL!,
    rootDomain: process.env.ROOT_DOMAIN!,
    authDomain: process.env.AUTH_DOMAIN!,
    apiDomain: process.env.API_DOMAIN!,
    dashDomain: process.env.DASH_DOMAIN!,
    internalApiToken: process.env.INTERNAL_API_TOKEN!,
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
    elasticUrl: process.env.ELASTIC_URL!,
    elasticUsername: process.env.ELASTIC_USERNAME!,
    elasticPassword: process.env.ELASTIC_PASSWORD!
  };

  container.register<Config>(kConfig, { useValue: config });
  return config;
};
