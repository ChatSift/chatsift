import { singleton } from 'tsyringe';

@singleton()
export class Env {
	public readonly discordToken = process.env.DISCORD_TOKEN!;

	private readonly REQUIRED_KEYS = ['DISCORD_TOKEN'] as const;

	public constructor() {
		for (const key of this.REQUIRED_KEYS) {
			if (!(key in process.env)) {
				throw new Error(`Missing environment variable ${key}`);
			}
		}
	}
}
