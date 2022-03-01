import type { CaseCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import {
	ApiGetGuildsCaseResult,
	ApiGetGuildsSettingsResult,
	ApiPatchGuildsCasesBody,
	ApiPostGuildsCasesResult,
	Case,
	Log,
	LogTypes,
	ms,
} from '@automoderator/core';
import { makeCaseEmbed } from '@automoderator/util';
import { UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@chatsift/api-wrapper';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, APIUser, ButtonStyle, ComponentType, Routes } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.mod;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly guildLogs: PubSubPublisher<Log>,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof CaseCommand>) {
		switch (Object.keys(args)[0] as keyof typeof args) {
			case 'show':
			case 'delete': {
				const isShow = Object.keys(args)[0] === 'show';
				const caseId = isShow ? args.show.case : args.delete.case;

				const cs = await this.rest
					.get<ApiGetGuildsCaseResult>(`/guilds/${interaction.guild_id}/cases/${caseId}`)
					.catch(() => null);
				if (!cs) {
					throw new ControlFlowError('Case could not be found');
				}

				const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

				const [target, mod] = await Promise.all([
					this.discordRest.get<APIUser>(Routes.user(cs.target_id)),
					cs.mod_id ? this.discordRest.get<APIUser>(Routes.user(cs.mod_id)) : Promise.resolve(null),
				]);

				let refCs: Case | null = null;
				if (cs.ref_id) {
					refCs = await this.rest
						.get<ApiGetGuildsCaseResult>(`/guilds/${interaction.guild_id}/cases/${cs.ref_id}`)
						.catch(() => null);
				}

				const embed = makeCaseEmbed({ logChannelId: settings.mod_action_log_channel, cs, target, mod, refCs });

				if (isShow) {
					return send(interaction, { embed });
				}

				const id = nanoid();

				return send(interaction, {
					content: 'Are you sure you want to delete this case?',
					embed,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									label: 'Cancel',
									style: ButtonStyle.Secondary,
									custom_id: `confirm-case-delete|${id}|${cs.case_id}|n`,
								},
								{
									type: ComponentType.Button,
									label: 'Confirm',
									style: ButtonStyle.Success,
									custom_id: `confirm-case-delete|${id}|${cs.case_id}|y`,
								},
							],
						},
					],
					flags: 64,
				});
			}

			case 'reason': {
				const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
					`/guilds/${interaction.guild_id}/cases`,
					[
						{
							case_id: args.reason.case,
							reason: args.reason.reason,
							mod_id: interaction.member.user.id,
							mod_tag: `${interaction.member.user.username}${interaction.member.user.discriminator}`,
						},
					],
				);

				await send(interaction, { content: 'Successfully updated the reason' });

				this.guildLogs.publish({
					type: LogTypes.modAction,
					data: cs!,
				});

				break;
			}

			case 'duration': {
				const duration = ms(args.duration.duration);
				if (!duration) {
					throw new ControlFlowError('Failed to parse the provided duration');
				}

				const expiresAt = new Date(Date.now() + duration);

				try {
					const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
						`/guilds/${interaction.guild_id}/cases`,
						[
							{
								case_id: args.duration.case,
								expires_at: expiresAt,
								mod_id: interaction.member.user.id,
								mod_tag: `${interaction.member.user.username}${interaction.member.user.discriminator}`,
							},
						],
					);

					await send(interaction, { content: 'Successfully updated the duration' });

					this.guildLogs.publish({
						type: LogTypes.modAction,
						data: cs!,
					});
				} catch (error) {
					if (error instanceof HTTPError) {
						switch (error.statusCode) {
							case 400: {
								return send(interaction, {
									content: 'Case duration can only be updated on mute or ban cases',
									flags: 64,
								});
							}

							default: {
								throw error;
							}
						}
					}

					throw error;
				}

				break;
			}

			case 'reference': {
				const [cs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
					`/guilds/${interaction.guild_id}/cases`,
					[
						{
							case_id: args.reference.case,
							ref_id: args.reference.reference,
							mod_id: interaction.member.user.id,
							mod_tag: `${interaction.member.user.username}${interaction.member.user.discriminator}`,
						},
					],
				);

				await send(interaction, { content: 'Successfully updated the reference' });

				this.guildLogs.publish({
					type: LogTypes.modAction,
					data: cs!,
				});

				break;
			}
		}
	}
}
