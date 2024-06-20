import { randomBytes } from 'node:crypto';
import { Env, INJECTION_TOKENS, type DiscordEventsMap, encode, decode } from '@automoderator/core';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { API, GatewayIntentBits } from '@discordjs/core';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { type Logger } from 'pino';

@injectable()
export class Gateway {
	readonly #broker: PubSubRedisBroker<DiscordEventsMap>;

	readonly #gateway: WebSocketManager;

	public constructor(
		private readonly env: Env,
		private readonly api: API,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		@inject(INJECTION_TOKENS.redis) private readonly redis: Redis,
	) {
		this.#broker = new PubSubRedisBroker<DiscordEventsMap>({
			redisClient: this.redis,
			encode,
			decode,
		});

		this.#gateway = new WebSocketManager({
			token: this.env.discordToken,
			rest: this.api.rest,
			intents:
				GatewayIntentBits.GuildMessages |
				GatewayIntentBits.GuildMembers |
				GatewayIntentBits.GuildModeration |
				GatewayIntentBits.MessageContent,
		});

		this.#gateway
			.on(WebSocketShardEvents.Debug, ({ message, shardId }) => this.logger.debug({ shardId }, message))
			.on(WebSocketShardEvents.Hello, ({ shardId }) => this.logger.debug({ shardId }, 'Shard HELLO'))
			.on(WebSocketShardEvents.Ready, ({ shardId }) => this.logger.debug({ shardId }, 'Shard READY'))
			.on(WebSocketShardEvents.Resumed, ({ shardId }) => this.logger.debug({ shardId }, 'Shard RESUMED'))
			.on(WebSocketShardEvents.Dispatch, ({ data }) => void this.#broker.publish(data.t, data.d));

		this.#broker.on('send', async ({ data, ack }) => {
			this.logger.info({ data }, 'Sending payload');

			if (data.shardId) {
				await this.#gateway.send(data.shardId, data.payload);
			} else {
				for (const shardId of await this.#gateway.getShardIds()) {
					await this.#gateway.send(shardId, data.payload);
				}
			}

			await ack();
		});
	}

	public async connect(): Promise<void> {
		// Want a random group name so we fan out gateway_send payloads
		await this.#broker.subscribe(randomBytes(16).toString('hex'), ['send']);
		await this.#gateway.connect();
	}
}
