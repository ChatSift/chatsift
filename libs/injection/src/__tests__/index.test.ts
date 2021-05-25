import 'reflect-metadata';
import { initConfig } from '../';

const data = {
  ROOT_DOMAIN: 'example.com',
  API_DOMAIN: 'api.example.com',
  AUTH_DOMAIN: 'auth.example.com',
  DASH_DOMAIN: 'dash.example.com',
  DISCORD_CLIENT_ID: '123',
  DISCORD_CLIENT_SECRET: '456',
  DISCORD_TOKEN: 'abc',
  DISCORD_SCOPES: 'a,b',
  DB_URL: 'postgres://something',
  ENCRYPTION_KEY: 'awooga'
} as const;

for (const key of Object.keys(data) as (keyof typeof data)[]) {
  process.env[key] = data[key];
}

test('test', () => {
  const config = initConfig();

  expect(config).toStrictEqual({
    rootDomain: data.ROOT_DOMAIN,
    apiDomain: data.API_DOMAIN,
    authDomain: data.AUTH_DOMAIN,
    dashDomain: data.DASH_DOMAIN,
    discordClientId: data.DISCORD_CLIENT_ID,
    discordClientSecret: data.DISCORD_CLIENT_SECRET,
    discordToken: data.DISCORD_TOKEN,
    discordScopes: 'a b',
    dbUrl: data.DB_URL,
    nodeEnv: 'test',
    encryptionKey: data.ENCRYPTION_KEY,
    cors: '*'
  });
});
