import * as interactions from '#interactions';
import { ControlFlowError, Interaction, send, transformInteraction } from '#util';
import { PermissionsChecker } from '@automoderator/util';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { readdirRecurse } from '@chatsift/readdir';
import {
	APIApplicationCommandInteractionData,
	APIMessageButtonInteractionData,
	RESTPutAPIApplicationCommandsJSONBody,
	RESTPutAPIApplicationCommandsResult,
	RESTPutAPIApplicationGuildCommandsJSONBody,
	RESTPutAPIApplicationGuildCommandsResult,
	Routes,
	Snowflake,
} from 'discord-api-types/v9';
import { join as joinPath } from 'path';
import type { Logger } from 'pino';
import { container, inject, InjectionToken, singleton } from 'tsyringe';
import { Command, commandInfo } from './command';
import { Component, componentInfo } from './component';
import { CollectableInteraction, CollectorManager } from './collector';

export * from './collector';

// TODO(DD): Figure out better type chain for interactions
@singleton()
export class Handler {
	public readonly commands = new Map<string, Command>();
	public readonly components = new Map<string, Component>();

	public readonly globalCommandIds = new Map<string, Snowflake>();
	public readonly testGuildCommandIds = new Map<`${Snowflake}-${string}`, Snowflake>();

	public readonly collectorManager = new CollectorManager();

	public constructor(
		@inject(kConfig) public readonly config: Config,
		@inject(kLogger) public readonly logger: Logger,
		public readonly checker: PermissionsChecker,
		public readonly rest: Rest,
	) {}

	public async handleCommand(interaction: Interaction) {
		const data = interaction.data as APIApplicationCommandInteractionData;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const command = this.commands.get(data?.name?.toLowerCase() ?? '');

		if (!command) {
			return send(interaction, {
				content: 'Please alert a developer! The command that you tried using was not registered internally.',
				flags: 64,
			});
		}

		try {
			await command.exec(interaction, transformInteraction(data));
		} catch (e) {
			const internal = !(e instanceof ControlFlowError);

			if (internal) {
				this.logger.error(e as any, `Failed to execute command "${data.name}"`);
			}

			const error = e as { message?: string; toString: () => string };
			const message = error.message ?? error.toString();

			void send(interaction, {
				content: internal
					? `Something went wrong! It's possible the bot is missing permissions or that this is a bug.\n\`${message}\``
					: message,
				flags: 64,
			});
		}
	}

	public async handleComponent(interaction: Interaction) {
		const data = interaction.data as APIMessageButtonInteractionData | undefined;
		const [componentId, ...extra] = (data?.custom_id!.split('|') ?? []) as [string, ...string[]];

		this.collectorManager.push(interaction as CollectableInteraction);

		const component = this.components.get(componentId ?? ''); // eslint-disable-line @typescript-eslint/no-unnecessary-condition

		if (component && data) {
			try {
				await component.exec(interaction, extra);
			} catch (e) {
				const internal = !(e instanceof ControlFlowError);

				if (internal) {
					this.logger.error(e as any, `Failed to execute component "${data.custom_id}"`);
				}

				const error = e as { message?: string; toString: () => string };
				const message = error.message ?? error.toString();

				void send(interaction, {
					content: internal
						? `Something went wrong! It's possible that the bot is missing permissions or that this is a bug.\n\`${message}\``
						: message,
					flags: 64,
				});
			}
		}
	}

	public handleModal(interaction: Interaction) {
		this.collectorManager.push(interaction as CollectableInteraction);
	}

	public async registerInteractions(): Promise<void> {
		const promises = [];

		if (this.config.nodeEnv === 'prod') {
			const res = await this.rest.put<RESTPutAPIApplicationCommandsResult, RESTPutAPIApplicationCommandsJSONBody>(
				Routes.applicationCommands(this.config.discordClientId),
				{
					// @ts-expect-error
					// TODO(DD): Find a fix for immutable and mutable clash
					data: Object.values(interactions).map((i) => ({ ...i, dm_permission: false })),
				},
			);

			for (const command of res) {
				this.globalCommandIds.set(command.name, command.id);
			}

			for (const guild of this.config.interactionsTestGuilds) {
				const promise = this.rest.put<unknown, RESTPutAPIApplicationCommandsJSONBody>(
					Routes.applicationGuildCommands(this.config.discordClientId, guild),
					{
						data: [],
					},
				);

				promises.push(promise);
			}

			await Promise.allSettled(promises);
			return;
		}

		await this.rest.put<unknown, RESTPutAPIApplicationCommandsJSONBody>(
			Routes.applicationCommands(this.config.discordClientId),
			{
				data: [],
			},
		);

		for (const guild of this.config.interactionsTestGuilds) {
			const promise = this.rest.put<
				RESTPutAPIApplicationGuildCommandsResult,
				RESTPutAPIApplicationGuildCommandsJSONBody
			>(Routes.applicationGuildCommands(this.config.discordClientId, guild), {
				// @ts-expect-error
				// TODO(DD): Find a fix for immutable and mutable clash
				data: Object.values(interactions),
			});

			promises.push(promise);
		}

		for (const promise of await Promise.allSettled(promises)) {
			if (promise.status === 'fulfilled') {
				for (const command of promise.value) {
					this.testGuildCommandIds.set(`${command.guild_id!}-${command.name}`, command.id);
				}
			}
		}
	}

	public async loadCommands(): Promise<void> {
		for await (const file of readdirRecurse(joinPath(__dirname, 'commands'), { fileExtensions: ['js'] })) {
			if (file.includes('/sub/')) {
				continue;
			}

			const info = commandInfo(file);

			if (!info) {
				continue;
			}

			const command = container.resolve(((await import(file)) as { default: InjectionToken<Command> }).default);
			this.commands.set(command.name ?? info.name, command);
		}
	}

	public async loadComponents(): Promise<void> {
		for await (const file of readdirRecurse(joinPath(__dirname, 'components'), { fileExtensions: ['js'] })) {
			const info = componentInfo(file);

			if (!info) {
				continue;
			}

			const component = container.resolve(((await import(file)) as { default: InjectionToken<Component> }).default);
			this.components.set(component.name ?? info.name, component);
		}
	}

	public async init(): Promise<void> {
		await this.registerInteractions();
		await this.loadCommands();
		await this.loadComponents();
	}
}
