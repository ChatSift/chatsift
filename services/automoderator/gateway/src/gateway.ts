import { randomBytes } from 'node:crypto';
import {
	INJECTION_TOKENS,
	type DiscordGatewayEventsMap,
	encode,
	decode,
	credentialsForCurrentBot,
} from '@automoderator/core';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { API, GatewayDispatchEvents, GatewayIntentBits } from '@discordjs/core';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { type Logger } from 'pino';

@injectable()
export class Gateway {
	public readonly guildsIds: Set<string> = new Set();

	readonly #broker: PubSubRedisBroker<DiscordGatewayEventsMap>;

	readonly #gateway: WebSocketManager;

	public constructor(
		private readonly api: API,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		@inject(INJECTION_TOKENS.redis) private readonly redis: Redis,
	) {
		const credentials = credentialsForCurrentBot();

		this.#broker = new PubSubRedisBroker<DiscordGatewayEventsMap>(this.redis, {
			// Want a random group name so we fan out gateway_send payloads
			group: randomBytes(16).toString('hex'),
			encode,
			decode,
		});

		this.#gateway = new WebSocketManager({
			token: credentials.token,
			rest: this.api.rest,
			intents:
				GatewayIntentBits.Guilds |
				GatewayIntentBits.GuildMessages |
				GatewayIntentBits.GuildMembers |
				GatewayIntentBits.GuildModeration |
				GatewayIntentBits.MessageContent,
		});

		this.#gateway
			.on(WebSocketShardEvents.Closed, (code, shardId) => this.logger.info({ shardId, code }, 'Shard CLOSED'))
			.on(WebSocketShardEvents.HeartbeatComplete, ({ ackAt, heartbeatAt, latency }, shardId) =>
				this.logger.debug({ shardId, ackAt, heartbeatAt, latency }, 'Shard HEARTBEAT'),
			)
			.on(WebSocketShardEvents.Error, (error, shardId) => this.logger.error({ shardId, error }, 'Shard ERROR'))
			.on(WebSocketShardEvents.Debug, (message, shardId) => this.logger.debug({ shardId }, message))
			.on(WebSocketShardEvents.Hello, (shardId) => this.logger.debug({ shardId }, 'Shard HELLO'))
			.on(WebSocketShardEvents.Ready, (shardId) => this.logger.debug({ shardId }, 'Shard READY'))
			.on(WebSocketShardEvents.Resumed, (shardId) => this.logger.debug({ shardId }, 'Shard RESUMED'))
			.on(WebSocketShardEvents.Dispatch, async (data) => {
				await this.#broker.publish(data.t, data.d);

				if (data.t === GatewayDispatchEvents.GuildCreate) {
					this.guildsIds.add(data.d.id);
				} else if (data.t === GatewayDispatchEvents.GuildDelete && !data.d.unavailable) {
					this.guildsIds.delete(data.d.id);
				}
			});

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
		await this.#broker.subscribe(['send']);
		await this.#gateway.connect();
	}
}
