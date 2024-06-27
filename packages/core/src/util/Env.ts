import process from 'node:process';
import { injectable } from 'inversify';

@injectable()
/**
 * The environment variables for the application, provided as a singleton.
 */
export class Env {
	public readonly discordToken: string = process.env.DISCORD_TOKEN!;

	public readonly discordClientId: string = process.env.DISCORD_CLIENT_ID!;

	public readonly redisUrl: string = process.env.REDIS_URL!;

	public readonly nodeEnv: 'dev' | 'prod' = (process.env.NODE_ENV ?? 'prod') as 'dev' | 'prod';

	public readonly discordProxyURL = process.env.DISCORD_PROXY_URL!;

	public readonly postgresHost: string = process.env.POSTGRES_HOST!;

	public readonly postgresPort: number = Number(process.env.POSTGRES_PORT!);

	public readonly postgresUser: string = process.env.POSTGRES_USER!;

	public readonly postgresPassword: string = process.env.POSTGRES_PASSWORD!;

	public readonly postgresDatabase: string = process.env.POSTGRES_DATABASE!;

	public readonly parseableDomain: string = process.env.PARSEABLE_DOMAIN!;

	public readonly parseableAuth: string = process.env.PARSEABLE_AUTH!;

	// TODO: Consider logging validation with zod?
	/**
	 * The name of the service, used as a prefix for log streams. Do not use any spaces/special chars.
	 *
	 * @example
	 * 'modmailbot'
	 */
	public readonly service: string = process.env.SERVICE_NAME!;

	// TODO: Consider validation with zod?
	public readonly admins: Set<string> = new Set(process.env.ADMINS?.split(',') ?? []);

	private readonly REQUIRED_KEYS = [
		'DISCORD_TOKEN',
		'DISCORD_CLIENT_ID',

		'REDIS_URL',

		'DISCORD_PROXY_URL',

		'POSTGRES_HOST',
		'POSTGRES_PORT',
		'POSTGRES_USER',
		'POSTGRES_PASSWORD',
		'POSTGRES_DATABASE',

		'PARSEABLE_DOMAIN',
		'PARSEABLE_AUTH',

		'SERVICE_NAME',
	] as const;

	public constructor() {
		const missingKeys = this.REQUIRED_KEYS.filter((key) => !(key in process.env));
		if (missingKeys.length) {
			throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
		}
	}
}
