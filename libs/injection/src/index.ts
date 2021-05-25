import { container } from 'tsyringe';

export const kConfig = Symbol('config');

export const kSql = Symbol('postgres instance');

export const kLogger = Symbol('logger instance');

export interface Config {
  rootDomain: string;
  authDomain: string;
  apiDomain: string;
  dashDomain: string;
  discordClientId: `${bigint}`;
  discordClientSecret: string;
  discordToken: string;
  discordScopes: string;
  dbUrl: string;
  nodeEnv: string;
  encryptionKey: string;
  cors: string | string[];
}

export const initConfig = () => {
  const config: Config = {
    rootDomain: process.env.ROOT_DOMAIN!,
    authDomain: process.env.AUTH_DOMAIN!,
    apiDomain: process.env.API_DOMAIN!,
    dashDomain: process.env.DASH_DOMAIN!,
    discordClientId: process.env.DISCORD_CLIENT_ID as `${bigint}`,
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET!,
    discordToken: process.env.DISCORD_TOKEN!,
    discordScopes: process.env.DISCORD_SCOPES!.split(',').join(' '),
    dbUrl: process.env.DB_URL!,
    nodeEnv: process.env.NODE_ENV ?? 'dev',
    encryptionKey: process.env.ENCRYPTION_KEY!,
    cors: process.env.CORS?.split(',') ?? '*'
  };

  container.register<Config>(kConfig, { useValue: config });
  return config;
};
