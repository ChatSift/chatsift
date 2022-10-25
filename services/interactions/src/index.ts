import 'reflect-metadata';
import type { DiscordEventsMap } from '@automoderator/common';
import { Env, encode, decode } from '@automoderator/common';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import type {
	APIApplicationCommandAutocompleteGuildInteraction,
	APIApplicationCommandGuildInteraction,
	APIMessageComponentGuildInteraction,
} from 'discord-api-types/v10';
import { GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import { CommandHandler } from './struct/CommandHandler';
import { logger } from './util/logger';

const env = container.resolve(Env);

const rest = new REST({ api: `${env.discordProxyURL}/api` }).setToken(env.discordToken);
const prisma = new PrismaClient();

container.register(REST, { useValue: rest });
container.register(PrismaClient, { useValue: prisma });

const redis = new Redis(env.redisUrl);
const broker = new PubSubRedisBroker<DiscordEventsMap>({ redisClient: redis, encode, decode });

// eslint-disable-next-line @typescript-eslint/no-misused-promises
broker.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, ack }) => {
	logger.info(interaction);
	await ack();
});

const commandHandler = await container.resolve(CommandHandler).init();

// eslint-disable-next-line @typescript-eslint/no-misused-promises
broker.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, ack }) => {
	if (!interaction.guild_id) {
		logger.warn('Received an interaction without a guild_id, ignoring');
		return;
	}

	switch (interaction.type) {
		case InteractionType.ApplicationCommandAutocomplete: {
			await commandHandler.handleAutocomplete(interaction as APIApplicationCommandAutocompleteGuildInteraction);
			break;
		}

		case InteractionType.MessageComponent: {
			await commandHandler.handleMessageComponent(interaction as APIMessageComponentGuildInteraction);
			break;
		}

		case InteractionType.ApplicationCommand: {
			await commandHandler.handleCommand(interaction as APIApplicationCommandGuildInteraction);
			break;
		}

		default: {
			logger.warn(`Unknown interaction type: ${interaction.type}`);
			break;
		}
	}

	await ack();
});

await broker.subscribe('interactions', [GatewayDispatchEvents.InteractionCreate]);
logger.info('Listening to incoming interactions');
