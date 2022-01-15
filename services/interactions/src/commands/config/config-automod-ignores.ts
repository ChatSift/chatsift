import { ConfigAutomodIgnoresCommand } from '#interactions';
import { ArgumentsOf, EMOTES, FilterIgnoresStateStore, send } from '#util';
import { ApiGetFiltersIgnoresResult, sortChannels } from '@automoderator/core';
import { ellipsis } from '@automoderator/util';
import { UserPerms } from '@automoderator/discord-permissions';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
	APISelectMenuOption,
	APIGuildInteraction,
	RESTGetAPIGuildChannelsResult,
	ChannelType,
	ComponentType,
	ButtonStyle,
	Routes,
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly filterIgnoreState: FilterIgnoresStateStore,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigAutomodIgnoresCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show': {
				const channels = new Map(
					await this.discordRest
						.get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
						.then((channels) => channels.map((channel) => [channel.id, channel])),
				);

				const entries = await this.rest.get<ApiGetFiltersIgnoresResult>(
					`/guilds/${interaction.guild_id}/filters/ignores`,
				);
				const ignores = entries.reduce<string[]>((acc, entry) => {
					const channel = channels.get(entry.channel_id);
					if (channel) {
						const channelMention = channel.type === ChannelType.GuildText ? `<#${channel.id}>` : channel.name;
						const enabled = new FilterIgnores(BigInt(entry.value)).toArray();

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
				const unsorted = await this.discordRest.get<RESTGetAPIGuildChannelsResult>(
					Routes.guildChannels(interaction.guild_id),
				);
				const channels = sortChannels(
					unsorted.filter(
						(channel) => channel.type === ChannelType.GuildCategory || channel.type === ChannelType.GuildText,
					),
				);

				const id = nanoid();

				const maxPages = Math.ceil(channels.length / 25);
				void this.filterIgnoreState.set(id, { page: 0, maxPages });

				return send(interaction, {
					content: 'Please select a channel...',
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.SelectMenu,
									custom_id: `filter-ignores-channel-select|${id}`,
									options: channels
										.map(
											(channel): APISelectMenuOption => ({
												label: ellipsis(channel.name!, 25),
												emoji: channel.type === ChannelType.GuildText ? EMOTES.TEXT_CHANNEL : EMOTES.CATEGORY_CHANNEL,
												value: channel.id,
											}),
										)
										.slice(0, 25),
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: '<',
									custom_id: `filter-ignores-channel-select-page|${id}|back`,
									style: ButtonStyle.Primary,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: 'Change channel page',
									custom_id: 'noop',
									style: ButtonStyle.Secondary,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: '>',
									custom_id: `filter-ignores-channel-select-page|${id}|forward`,
									style: ButtonStyle.Primary,
									disabled: maxPages === 1,
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'URLs',
									custom_id: `filter-ignores-update|${id}|urls`,
									style: ButtonStyle.Danger,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: 'Files',
									custom_id: `filter-ignores-update|${id}|files`,
									style: ButtonStyle.Danger,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: 'Invites',
									custom_id: `filter-ignores-update|${id}|invites`,
									style: ButtonStyle.Danger,
									disabled: true,
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'Words',
									custom_id: `filter-ignores-update|${id}|words`,
									style: ButtonStyle.Danger,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: 'Global',
									custom_id: `filter-ignores-update|${id}|global`,
									style: ButtonStyle.Danger,
									disabled: true,
								},
								{
									type: ComponentType.Button,
									label: 'Automod',
									custom_id: `filter-ignores-update|${id}|automod`,
									style: ButtonStyle.Danger,
									disabled: true,
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'Done',
									custom_id: `filter-ignores-done|${id}`,
									style: ButtonStyle.Secondary,
								},
							],
						},
					],
				});
			}
		}
	}
}
