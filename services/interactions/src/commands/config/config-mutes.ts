import { DiscordPermissions } from '@automoderator/broker-types';
import { ellipsis, sortChannels } from '@chatsift/discord-utils';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import type {
	APIMessageComponentInteraction,
	APIMessageSelectMenuInteractionData,
	APISelectMenuOption,
	RESTPutAPIChannelPermissionJSONBody,
	APIChannel,
	APIGuildInteraction,
	APISelectMenuComponent,
} from 'discord-api-types/v9';
import {
	ChannelType,
	OverwriteType,
	Routes,
	ButtonStyle,
	ComponentType,
	InteractionResponseType,
	PermissionFlagsBits,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';
import type { ConfigMutesCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { send, EMOTES } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: REST,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigMutesCommand>) {
		switch (Object.keys(args)[0] as 'update-role' | 'use') {
			case 'use': {
				await this.prisma.guildSettings.upsert({
					create: {
						guildId: interaction.guild_id,
						useTimeoutsByDefault: args.use.type === 'timeout',
					},
					update: {
						useTimeoutsByDefault: args.use.type === 'timeout',
					},
					where: {
						guildId: interaction.guild_id,
					},
				});

				return send(interaction, { content: 'Successfully updated your preferences' });
			}

			case 'update-role': {
				const permsId = nanoid();
				const ignoreId = nanoid();
				const confirmId = nanoid();

				const state = {
					page: 0,
					perms: new DiscordPermissions(0n),
					ignores: new Set<string>(),
				};

				const permOptions: APISelectMenuOption[] = [
					{
						label: 'Send Messages',
						value: String(PermissionFlagsBits.SendMessages),
					},
					{
						label: 'Send Messages in Threads',
						value: String(PermissionFlagsBits.SendMessagesInThreads),
					},
					{
						label: 'Create Public Threads',
						value: String(PermissionFlagsBits.CreatePublicThreads),
					},
					{
						label: 'Create Private Threads',
						value: String(PermissionFlagsBits.CreatePrivateThreads),
					},
					{
						label: 'Add Reactions',
						value: String(PermissionFlagsBits.AddReactions),
					},
					{
						label: 'Connect to Voice Channels',
						value: String(PermissionFlagsBits.Connect),
					},
					{
						label: 'Speak in Voice Channels',
						value: String(PermissionFlagsBits.Speak),
					},
				];

				const channelList = sortChannels(
					(await this.rest.get(Routes.guildChannels(interaction.guild_id))) as APIChannel[],
				);
				const channelOptions = channelList.map(
					(channel): APISelectMenuOption => ({
						label: ellipsis(channel.name!, 25),
						value: channel.id,
						emoji: channel.type === ChannelType.GuildText ? EMOTES.TEXT_CHANNEL : EMOTES.CATEGORY_CHANNEL,
					}),
				);

				const getChannelOptions = (page: number): APISelectMenuOption[] => {
					// Take chunk of 25 elements
					const chunk = channelOptions.slice(page * 25, page * 25 + 25);
					const pageCount = Math.ceil(channelOptions.length / 25);
					const isFirstPage = page === 0;
					const isLastPage = pageCount === page + 1;

					if (isFirstPage && isLastPage) {
						return chunk;
					}

					const next = {
						label: 'Next page',
						value: 'next',
						emoji: {
							name: '▶️',
						},
					};
					const last = {
						label: 'Previous page',
						value: 'prev',
						emoji: {
							name: '◀️',
						},
					};

					if (isFirstPage) {
						return [...chunk.slice(0, 24), next];
					}

					if (isLastPage) {
						return [last, ...chunk.slice(0, 24)];
					}

					return [last, ...chunk.slice(0, 23), next];
				};

				await send(interaction, {
					content:
						'If you want the bot to set up permissions for you now, please configure the behavior using the dropdowns below - otherwise you can just confirm',
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: permsId,
									min_values: 0,
									max_values: permOptions.length,
									options: permOptions,
									placeholder: 'Permissions you want to deny',
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: ignoreId,
									min_values: 0,
									max_values: getChannelOptions(0).length,
									options: getChannelOptions(0),
									placeholder: 'Channels you want to exclude from the above permissions',
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									custom_id: confirmId,
									label: 'Confirm',
									style: ButtonStyle.Success,
								},
							],
						},
					],
					flags: 64,
				});

				const stopCollectingPerms = this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(permsId)
					.hookAndDestroy(async (component) => {
						const { values } = component.data as APIMessageSelectMenuInteractionData;
						state.perms = new DiscordPermissions(values.map((v) => BigInt(v)));

						const messageComponent = component.message.components![0]!.components[0] as APISelectMenuComponent;
						messageComponent.options = messageComponent.options.map((option) => ({
							...option,
							default: state.perms.has(BigInt(option.value)),
						}));

						await send(component, { components: component.message.components }, InteractionResponseType.UpdateMessage);
					});

				const stopCollectingIgnores = this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(ignoreId)
					.hookAndDestroy(async (component) => {
						const { values: rawValues } = component.data as APIMessageSelectMenuInteractionData;
						let goBack = false;
						let goForward = false;

						if (rawValues.includes('prev')) {
							const idx = rawValues.findIndex((v) => v === 'prev')!;
							rawValues.splice(idx);
							goBack = true;
						}

						if (rawValues.includes('next')) {
							const idx = rawValues.findIndex((v) => v === 'next')!;
							rawValues.splice(idx);
							goForward = true;
						}

						const values = new Set(rawValues);

						for (const value of getChannelOptions(state.page).map((o) => o.value)) {
							if (values.has(value)) {
								state.ignores.add(value);
							} else {
								state.ignores.delete(value);
							}
						}

						const messageComponent = component.message.components![1]!.components[0] as APISelectMenuComponent;

						const mapFn = (option: APISelectMenuOption) => ({
							...option,
							default: state.ignores.has(option.value),
						});

						if ((!goBack && !goForward) || (goBack && goForward)) {
							messageComponent.options = messageComponent.options.map(mapFn);
						} else if (goBack) {
							messageComponent.options = getChannelOptions(--state.page).map(mapFn);
						} else if (goForward) {
							messageComponent.options = getChannelOptions(++state.page).map(mapFn);
						}

						messageComponent.max_values = messageComponent.options.length;
						await send(component, { components: component.message.components }, InteractionResponseType.UpdateMessage);
					});

				const done = await this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(confirmId)
					.waitForOneAndDestroy();

				await send(
					done,
					{ content: 'Going through your channels..', flags: 64, components: [] },
					InteractionResponseType.DeferredMessageUpdate,
				);

				stopCollectingPerms();
				stopCollectingIgnores();

				for (const channel of channelList.filter(
					(c) => !state.ignores.has(c.id) && (!c.parent_id || !state.ignores.has(c.parent_id)),
				)) {
					const body: RESTPutAPIChannelPermissionJSONBody = {
						type: OverwriteType.Role,
						deny: state.perms.toJSON(),
					};
					await this.rest.put(Routes.channelPermission(channel.id, args['update-role'].role.id), {
						body,
					});
				}

				await this.prisma.guildSettings.upsert({
					create: {
						guildId: interaction.guild_id,
						muteRole: args['update-role'].role.id,
					},
					update: {
						muteRole: args['update-role'].role.id,
					},
					where: {
						guildId: interaction.guild_id,
					},
				});

				await send(
					done,
					{ content: 'Successfully set up your mute role', components: [] },
					InteractionResponseType.UpdateMessage,
				);
			}
		}
	}
}
