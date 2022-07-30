import { FilterIgnores, FILTERS } from '@automoderator/broker-types';
import { ellipsis, sortChannels } from '@chatsift/discord-utils';
import { Rest as DiscordRest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import {
	APISelectMenuOption,
	APIGuildInteraction,
	RESTGetAPIGuildChannelsResult,
	ChannelType,
	ComponentType,
	ButtonStyle,
	Routes,
	APIButtonComponent,
	APIChannel,
	APIMessageComponentInteraction,
	APIMessageSelectMenuInteractionData,
	APISelectMenuComponent,
	InteractionResponseType,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';
import type { ConfigAutomodIgnoresCommand } from '#interactions';
import { ArgumentsOf, EMOTES, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: DiscordRest,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigAutomodIgnoresCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show': {
				const channelsList = await this.rest
					.get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
					.then((channels) => channels.map((channel): [string, APIChannel] => [channel.id, channel]));
				const channels = new Map(channelsList);

				const entries = await this.prisma.filterIgnore.findMany({ where: { guildId: interaction.guild_id } });
				const ignores = entries.reduce<string[]>((acc, entry) => {
					const channel = channels.get(entry.channelId);
					if (channel) {
						const channelMention = channel.type === ChannelType.GuildText ? `<#${channel.id}>` : channel.name!;
						const enabled = new FilterIgnores(entry.value).toArray();

						if (enabled.length) {
							acc.push(`• ${channelMention}: ${enabled.join(', ')}`);
						}
					}

					return acc;
				}, []);

				return send(interaction, {
					content: entries.length
						? `Here are your current ignores:\n${ignores.join('\n')}`
						: 'There are no ignores currently enabled',
				});
			}

			case 'update': {
				const channelsId = nanoid();
				const ignoresId = nanoid();
				const updateId = nanoid();
				const doneId = nanoid();

				const state = {
					page: 0,
					flags: new FilterIgnores(0n),
					channel: null as string | null,
				};

				const channelList = sortChannels(await this.rest.get<APIChannel[]>(Routes.guildChannels(interaction.guild_id)));
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

				const ignoreOptions: APISelectMenuOption[] = [
					{
						label: 'URLs',
						value: String(FILTERS.urls),
					},
					{
						label: 'Files',
						value: String(FILTERS.files),
					},
					{
						label: 'Invites',
						value: String(FILTERS.invites),
					},
					{
						label: 'Words',
						value: String(FILTERS.words),
					},
					{
						label: 'Global',
						value: String(FILTERS.global),
					},
					{
						label: 'Automod',
						value: String(FILTERS.automod),
					},
				];

				await send(interaction, {
					content: 'Please select a channel...',
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: channelsId,
									options: getChannelOptions(0),
									min_values: 1,
									max_values: 1,
									placeholder: 'Channel',
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: ignoresId,
									disabled: true,
									options: ignoreOptions,
									min_values: 0,
									max_values: ignoreOptions.length,
									placeholder: 'Ignores',
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'Update',
									custom_id: updateId,
									style: ButtonStyle.Primary,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: 'Done',
									custom_id: doneId,
									style: ButtonStyle.Success,
								},
							],
						},
					],
				});

				const stopCollectingChannel = this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(channelsId)
					.hookAndDestroy(async (component) => {
						const {
							values: [value],
						} = component.data as APIMessageSelectMenuInteractionData;
						const messageComponent = component.message.components![0]!.components[0] as APISelectMenuComponent;
						const ignores = component.message.components![1]!.components[0] as APISelectMenuComponent;
						const confirmButton = component.message.components![2]!.components[0] as APIButtonComponent;

						const mapFn = (option: APISelectMenuOption) => ({
							...option,
							default: state.channel === option.value,
						});

						const channel = await this.prisma.filterIgnore.findFirst({ where: { channelId: value } });

						state.flags = new FilterIgnores(channel?.value ?? 0n);
						ignores.options = ignores.options.map((option) => ({
							...option,
							default: state.flags.has(BigInt(option.value)),
						}));

						if (value === 'prev') {
							messageComponent.options = getChannelOptions(--state.page).map(mapFn);
							ignores.disabled = true;
							confirmButton.disabled = true;
						} else if (value === 'next') {
							messageComponent.options = getChannelOptions(++state.page).map(mapFn);
							ignores.disabled = true;
							confirmButton.disabled = true;
						} else {
							state.channel = value!;
							messageComponent.options = messageComponent.options.map(mapFn);
							ignores.disabled = false;
							confirmButton.disabled = false;
						}

						await send(
							component,
							{
								content: 'Use the 2nd dropdown to select what should be ignored, then use the Update button to confirm',
								components: component.message.components,
							},
							InteractionResponseType.UpdateMessage,
						);
					});

				const stopCollectingIgnores = this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(ignoresId)
					.hookAndDestroy(async (component) => {
						const { values } = component.data as APIMessageSelectMenuInteractionData;
						state.flags = new FilterIgnores(values.map((v) => BigInt(v)));

						const messageComponent = component.message.components![1]!.components[0] as APISelectMenuComponent;
						messageComponent.options = messageComponent.options.map((option) => ({
							...option,
							default: state.flags.has(BigInt(option.value)),
						}));

						await send(component, { components: component.message.components }, InteractionResponseType.UpdateMessage);
					});

				const stopCollectingUpdates = this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(updateId)
					.hookAndDestroy(async (component) => {
						if (!state.channel) {
							return send(
								component,
								{ content: 'Please select a channel first.' },
								InteractionResponseType.UpdateMessage,
							);
						}

						const data = {
							guildId: interaction.guild_id,
							channelId: state.channel,
							value: state.flags.valueOf(),
						};

						await this.prisma.filterIgnore.upsert({
							create: data,
							update: data,
							where: { channelId: state.channel },
						});

						return send(component, {}, InteractionResponseType.UpdateMessage);
					});

				const done = await this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(doneId)
					.waitForOneAndDestroy();

				stopCollectingIgnores();
				stopCollectingChannel();
				stopCollectingUpdates();

				await send(
					done,
					{ content: 'Successfully registered your changes', components: [] },
					InteractionResponseType.UpdateMessage,
				);
			}
		}
	}
}
