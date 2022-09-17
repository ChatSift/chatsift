import { ellipsis, sortChannels } from '@chatsift/discord-utils';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import type {
	APIChannel,
	APIMessageComponentInteraction,
	APIMessageSelectMenuInteractionData,
	APISelectMenuComponent,
	APISelectMenuOption,
	APIGuildInteraction,
	RESTGetAPIGuildChannelsResult,
} from 'discord-api-types/v9';
import { InteractionResponseType, ChannelType, ComponentType, ButtonStyle, Routes } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import { Handler } from '../../handler';
import type { ConfigLogIgnoresCommand } from '#interactions';
import type { ArgumentsOf } from '#util';
import { EMOTES, send } from '#util';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: REST,
		public readonly prisma: PrismaClient,
		public readonly handler: Handler,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigLogIgnoresCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show': {
				const channelList = await (
					this.rest.get(Routes.guildChannels(interaction.guild_id)) as Promise<RESTGetAPIGuildChannelsResult>
				).then((channels) => channels.map((channel): [string, APIChannel] => [channel.id, channel]));
				const channels = new Map(channelList);

				const entries = await this.prisma.logIgnore.findMany({ where: { guildId: interaction.guild_id } });
				const ignores = entries.reduce<string[]>((acc, entry) => {
					const channel = channels.get(entry.channelId);
					if (channel) {
						const channelMention = channel.type === ChannelType.GuildText ? `<#${channel.id}>` : channel.name!;
						acc.push(`• ${channelMention}`);
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
				const doneId = nanoid();

				const existingList = await this.prisma.logIgnore.findMany({ where: { guildId: interaction.guild_id } });

				const state = {
					page: 0,
					channels: new Set(existingList.map((entry) => entry.channelId)),
				};

				const channelList = sortChannels(
					(await this.rest.get(Routes.guildChannels(interaction.guild_id))) as APIChannel[],
				);
				const channelOptions = channelList.map(
					(channel): APISelectMenuOption => ({
						label: ellipsis(channel.name!, 25),
						value: channel.id,
						emoji: channel.type === ChannelType.GuildText ? EMOTES.TEXT_CHANNEL : EMOTES.CATEGORY_CHANNEL,
						default: state.channels.has(channel.id),
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
					content: 'Please select a channel...',
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: channelsId,
									options: getChannelOptions(0),
									min_values: 0,
									max_values: getChannelOptions(0).length,
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
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

				const stopCollectingChannels = this.handler.collectorManager
					.makeCollector<APIMessageComponentInteraction>(channelsId)
					.hookAndDestroy(async (component) => {
						const { values: rawValues } = component.data as APIMessageSelectMenuInteractionData;
						let goBack = false;
						let goForward = false;

						const messageComponent = component.message.components![0]!.components[0] as APISelectMenuComponent;

						// eslint-disable-next-line unicorn/consistent-function-scoping
						const mapFn = (option: APISelectMenuOption) => ({
							...option,
							default: state.channels.has(option.value),
						});

						if (rawValues.includes('prev')) {
							const idx = rawValues.indexOf('prev')!;
							rawValues.splice(idx);
							goBack = true;
						}

						if (rawValues.includes('next')) {
							const idx = rawValues.indexOf('next')!;
							rawValues.splice(idx);
							goForward = true;
						}

						const values = new Set(rawValues);

						for (const value of getChannelOptions(state.page).map((option) => option.value)) {
							if (values.has(value)) {
								state.channels.add(value);
							} else {
								state.channels.delete(value);
							}
						}

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
					.makeCollector<APIMessageComponentInteraction>(doneId)
					.waitForOneAndDestroy();

				stopCollectingChannels();

				await this.prisma.logIgnore.deleteMany({ where: { guildId: interaction.guild_id } });
				await this.prisma.logIgnore.createMany({
					data: [...state.channels].map((channelId) => ({ guildId: interaction.guild_id, channelId })),
				});

				await send(
					done,
					{ content: 'Successfully registered your changes', components: [] },
					InteractionResponseType.UpdateMessage,
				);
			}
		}
	}
}
