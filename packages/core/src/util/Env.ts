import process from 'node:process';
import { injectable } from 'inversify';

@injectable()
/**
 * The environment variables for the application, provided as a singleton.
 */
export class Env {
	public readonly discordToken: string = process.env.DISCORD_TOKEN!;

	public readonly discordClientId: string = process.env.DISCORD_CLIENT_ID!;

	public readonly redisURL: string = process.env.REDIS_URL!;

	public readonly nodeEnv: 'dev' | 'prod' = (process.env.NODE_ENV ?? 'prod') as 'dev' | 'prod';

	public readonly discordProxyURL = process.env.DISCORD_PROXY_URL!;

	public readonly postgresHost: string = process.env.POSTGRES_HOST!;

	public readonly postgresPort: number = Number(process.env.POSTGRES_PORT!);

	public readonly postgresUser: string = process.env.POSTGRES_USER!;

	public readonly postgresPassword: string = process.env.POSTGRES_PASSWORD!;

	public readonly postgresDatabase: string = process.env.POSTGRES_DATABASE!;

	// TODO: Consider validation with zod?
	public readonly admins: Set<string> = new Set(process.env.ADMINS?.split(',') ?? []);

	public readonly logsDir: string = process.env.LOGS_DIR!;

	public readonly apiURL: string = process.env.API_URL!;

	// Required type to use as a zod enum
	public readonly allowedAPIOrigins = process.env.ALLOWED_API_ORIGINS!.split(',') as [string, ...string[]];

	public readonly secretSigningKey: string = process.env.SECRET_SIGNING_KEY!;

	public readonly publicApiURL: string = process.env.PUBLIC_API_URL!;

	public readonly oauthDiscordClientId: string = process.env.OAUTH_DISCORD_CLIENT_ID!;

	public readonly oauthDiscordClientSecret: string = process.env.OAUTH_DISCORD_CLIENT_SECRET!;

	public readonly cors: RegExp | null = process.env.CORS ? new RegExp(process.env.CORS) : null;

	public readonly automoderatorGatewayURL: string = process.env.AUTOMODERATOR_GATEWAY_URL!;

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

		'LOGS_DIR',

		'API_URL',

		'ALLOWED_API_ORIGINS',
		'SECRET_SIGNING_KEY',
		'PUBLIC_API_URL',
		'OAUTH_DISCORD_CLIENT_ID',
		'OAUTH_DISCORD_CLIENT_SECRET',
		'CORS',

		'AUTOMODERATOR_GATEWAY_URL',
	] as const;

	public constructor() {
		const missingKeys = this.REQUIRED_KEYS.filter((key) => !(key in process.env));
		if (missingKeys.length) {
			throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
		}
	}
}
