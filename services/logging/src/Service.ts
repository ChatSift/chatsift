import {
	INJECTION_TOKENS,
	type GuildLogMap,
	encode,
	decode,
	GuildLogType,
	LogEmbedBuilder,
	type DB,
	LogChannelType,
	promiseAllObject,
	CaseAction,
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
	private readonly broker: PubSubRedisBroker<GuildLogMap>;

	public constructor(
		@inject(INJECTION_TOKENS.redis) private readonly redis: Redis,
		private readonly guildLogger: GuildLogger,
		private readonly api: API,
		@inject(Kysely) private readonly database: Kysely<DB>,
		private readonly embedBuilder: LogEmbedBuilder,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
	) {
		this.broker = new PubSubRedisBroker<GuildLogMap>({ redisClient: this.redis, encode, decode });

		this.broker.on(GuildLogType.ModAction, async ({ data: { cases }, ack }) => {
			for (const cs of cases) {
				const warnData =
					cs.actionType === CaseAction.warn
						? await this.database.selectFrom('WarnCaseData').select('pardonedById').executeTakeFirst()
						: null;

				const apiData = await promiseAllObject({
					mod: cs.modId ? this.api.users.get(cs.modId) : Promise.resolve(null),
					user: cs.targetId ? this.api.users.get(cs.targetId) : Promise.resolve(null),
					existingEmbed:
						cs.logChannelId && cs.logMessageId
							? this.api.channels.getMessage(cs.logChannelId, cs.logMessageId).then((message) => message.embeds[0])
							: Promise.resolve(null),
					pardonedBy: warnData?.pardonedById ? this.api.users.get(warnData?.pardonedById) : Promise.resolve(null),
				});

				const refCases = await this.database
					.selectFrom('CaseReference')
					.innerJoin('Case', 'Case.id', 'CaseReference.refId')
					.selectAll()
					.execute();

				const referencedBy = await this.database
					.selectFrom('CaseReference')
					.innerJoin('Case', 'Case.id', 'CaseReference.caseId')
					.selectAll()
					.execute();

				const embed = this.embedBuilder.buildModActionLog({
					cs,
					...apiData,
					refCases,
					referencedBy,
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
