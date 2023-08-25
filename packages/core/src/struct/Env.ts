import process from 'node:process';
import { injectable } from 'inversify';

@injectable()
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

	// null means the current process is not a task runner
	public readonly taskRunnerId: number | null = process.env.TASK_RUNNER_ID ? Number(process.env.TASK_RUNNER_ID) : null;

	// Indicates how many task runners the stack is running
	public readonly taskRunnerConcurrency: number = Number(process.env.TASK_RUNNER_CONCURRENCY ?? '1');

	private readonly REQUIRED_KEYS = [
		'DISCORD_TOKEN',
		'DISCORD_CLIENT_ID',
		'REDIS_URL',
		'DISCORD_PROXY_URL',
		'POSTGRES_HOST',
		'POSTGRES_USER',
		'POSTGRES_PASSWORD',
		'POSTGRES_DATABASE',
		'TASK_RUNNER_CONCURRENCY',
	] as const;

	public constructor() {
		for (const key of this.REQUIRED_KEYS) {
			if (!(key in process.env)) {
				throw new Error(`Missing environment variable ${key}`);
			}
		}
	}
}
