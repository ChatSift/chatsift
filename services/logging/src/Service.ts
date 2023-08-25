import {
	INJECTION_TOKENS,
	type GuildLogMap,
	encode,
	decode,
	GuildLogType,
	LogEmbedBuilder,
	type DB,
	LogChannelType,
} from '@automoderator/core';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { API } from '@discordjs/core';
import { inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { Kysely } from 'kysely';
import { type Logger } from 'pino';
import { GuildLogger } from './GuildLogger.js';

@injectable()
export class LoggingService {
	@inject(INJECTION_TOKENS.redis)
	private readonly redis!: Redis;

	@inject(GuildLogger)
	private readonly guildLogger!: GuildLogger;

	@inject(API)
	private readonly api!: API;

	@inject(Kysely)
	private readonly database!: Kysely<DB>;

	@inject(LogEmbedBuilder)
	private readonly embedBuilder!: LogEmbedBuilder;

	@inject(INJECTION_TOKENS.logger)
	private readonly logger!: Logger;

	private readonly broker: PubSubRedisBroker<GuildLogMap>;

	public constructor() {
		this.broker = new PubSubRedisBroker<GuildLogMap>({ redisClient: this.redis, encode, decode });

		this.broker.on(GuildLogType.ModAction, async ({ data: { cases }, ack }) => {
			for (const cs of cases) {
				const [mod, user, pardonedBy, refCs, existingLogMessage] = await Promise.all([
					cs.modId ? this.api.users.get(cs.modId) : Promise.resolve(null),
					cs.targetId ? this.api.users.get(cs.targetId) : Promise.resolve(null),
					cs.pardonedBy ? this.api.users.get(cs.pardonedBy) : Promise.resolve(null),
					cs.refId
						? this.database
								.selectFrom('Case')
								.selectAll()
								.where('guildId', '=', cs.guildId)
								.where('id', '=', cs.refId)
								.executeTakeFirst()
						: Promise.resolve(null),
					cs.logChannelId && cs.logMessageId
						? this.api.channels.getMessage(cs.logChannelId, cs.logMessageId)
						: Promise.resolve(null),
				]);

				const embed = this.embedBuilder.buildModActionLog({
					cs,
					mod,
					user,
					existingEmbed: existingLogMessage?.embeds[0],
					refCs,
					pardonedBy,
				});

				await this.guildLogger.log({ guildId: cs.guildId, logType: LogChannelType.mod, embed, ack });
			}
		});
	}

	public async start(): Promise<void> {
		await this.broker.subscribe('logging', Object.values(GuildLogType));
		this.logger.info('Subscribed to logging events');
	}
}
