import process from 'node:process';
import { injectable } from 'inversify';

@injectable()
/**
 * The environment variables for the application, provided as a singleton.
 */
export class Env {
	public readonly discordToken = process.env.DISCORD_TOKEN!;

	public readonly discordClientId = process.env.DISCORD_CLIENT_ID!;

	public readonly redisUrl = process.env.REDIS_URL!;

	public readonly nodeEnv: 'dev' | 'prod' = (process.env.NODE_ENV ?? 'prod') as 'dev' | 'prod';

	public readonly discordProxyURL = process.env.DISCORD_PROXY_URL!;

	public readonly postgresHost: string = process.env.POSTGRES_HOST!;

	public readonly postgresPort: number = Number(process.env.POSTGRES_PORT ?? '5432');

	public readonly postgresUser: string = process.env.POSTGRES_USER!;

	public readonly postgresPassword: string = process.env.POSTGRES_PASSWORD!;

	public readonly postgresDatabase: string = process.env.POSTGRES_DATABASE!;

	private readonly REQUIRED_KEYS = [
		'DISCORD_TOKEN',
		'DISCORD_CLIENT_ID',
		'REDIS_URL',
		'DISCORD_PROXY_URL',
		'POSTGRES_HOST',
		'POSTGRES_USER',
		'POSTGRES_PASSWORD',
		'POSTGRES_DATABASE',
	] as const;

	public constructor() {
		for (const key of this.REQUIRED_KEYS) {
			if (!(key in process.env)) {
				throw new Error(`Missing environment variable ${key}`);
			}
		}
	}
}
