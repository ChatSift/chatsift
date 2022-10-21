import 'reflect-metadata';
import {
	createLogger,
	Env,
	GuildLogMap,
	GuildLogModActionData,
	GuildLogType,
	LogEmbedBuilder,
	encode,
	decode,
} from '@automoderator/common';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { REST } from '@discordjs/rest';
import { CaseAction, LogChannelType, PrismaClient } from '@prisma/client';
import { APIMessage, APIUser, Routes } from 'discord-api-types/v10';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import { GuildLogger } from './GuildLogger';

const env = container.resolve(Env);

const logger = createLogger('logging');
const rest = new REST().setToken(env.discordToken);
const prisma = new PrismaClient();

container.register(REST, { useValue: rest });
container.register(PrismaClient, { useValue: prisma });

const logEmbedBuilder = container.resolve(LogEmbedBuilder);
const guildLogger = container.resolve(GuildLogger);

const redis = new Redis(env.redisUrl);
const broker = new PubSubRedisBroker<GuildLogMap>({ redisClient: redis, encode, decode });

// eslint-disable-next-line @typescript-eslint/no-misused-promises
broker.on(GuildLogType.ModAction, async ({ data: { cases }, ack }) => {
	for (const cs of cases) {
		const [mod, user, pardonedBy, refCs, existingLogMessage] = await Promise.all([
			cs.modId ? (rest.get(Routes.user(cs.modId)) as Promise<APIUser>) : Promise.resolve(null),
			cs.targetId ? (rest.get(Routes.user(cs.targetId)) as Promise<APIUser>) : Promise.resolve(null),
			cs.pardonedBy ? (rest.get(Routes.user(cs.pardonedBy)) as Promise<APIUser>) : Promise.resolve(null),
			cs.refId ? prisma.case.findFirst({ where: { guildId: cs.guildId, refId: cs.refId } }) : Promise.resolve(null),
			cs.logChannelId && cs.logMessageId
				? (rest.get(Routes.channelMessage(cs.logChannelId, cs.logMessageId)) as Promise<APIMessage>)
				: Promise.resolve(null),
		]);

		const embed = logEmbedBuilder.buildModActionLog({
			cs,
			mod,
			user,
			existingEmbed: existingLogMessage?.embeds[0],
			refCs,
			pardonedBy,
		});

		await guildLogger.log(cs.guildId, LogChannelType.mod, embed, ack);
	}
});

// @ts-expect-error
await broker.subscribe('logging', Object.values(GuildLogType));
logger.info('Subscribed to logging channels');

const testPayload: GuildLogModActionData = {
	guildId: '878276317525737502',
	cases: [
		{
			id: 12345678,
			guildId: '878276317525737502',
			logChannelId: null,
			logMessageId: null,
			caseId: 12345,
			refId: 12344,
			targetId: '104425482757357568',
			targetTag: 'Tommyfoxy2#0001',
			modId: '223703707118731264',
			modTag: 'DD#0003',
			actionType: CaseAction.ban,
			reason: 'test',
			duration: 3_600_000n,
			useTimeouts: false,
			createdAt: new Date(),
			expiresAt: new Date(Date.now() + 3_600_000),
			pardonedBy: null,
		},
	],
};

await broker.publish(GuildLogType.ModAction, testPayload);
