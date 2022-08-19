import { singleton } from 'tsyringe';

@singleton()
export class Env {
	public readonly discordToken = process.env.DISCORD_TOKEN!;
	public readonly redisUrl = process.env.REDIS_URL!;
	public readonly nodeEnv: 'dev' | 'prod' = (process.env.NODE_ENV ?? 'prod') as 'dev' | 'prod';

	private readonly REQUIRED_KEYS = ['DISCORD_TOKEN', 'REDIS_URL'] as const;

	public constructor() {
		for (const key of this.REQUIRED_KEYS) {
			if (!(key in process.env)) {
				throw new Error(`Missing environment variable ${key}`);
			}
		}
	}
}
