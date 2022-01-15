import { RaidCleanupMembersStore, send } from '#util';
import {
	ApiPostGuildsCasesBody,
	ApiPostGuildsCasesResult,
	CaseAction,
	HttpCase,
	Log,
	LogTypes,
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { kLogger, kSql } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { APIGuildInteraction, InteractionResponseType, Snowflake } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public readonly userPermissions = UserPerms.mod;

	public constructor(
		public readonly raidCleanupMembers: RaidCleanupMembersStore,
		public readonly rest: Rest,
		public readonly guildLogs: PubSubPublisher<Log>,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kSql) public readonly sql: Sql<{}>,
	) {}

	public async exec(interaction: APIGuildInteraction, [action]: [string], id: string) {
		void send(interaction, { components: [] }, InteractionResponseType.UpdateMessage);

		const { members, ban } = (await this.raidCleanupMembers.get(id))!;
		void this.raidCleanupMembers.delete(id);

		if (action === 'n') {
			return send(
				interaction,
				{ content: 'Canceled raid cleanup' },
				InteractionResponseType.ChannelMessageWithSource,
				true,
			);
		}

		const promises: Promise<void>[] = [];
		const cases: HttpCase[] = [];
		const sweeped: Snowflake[] = [];
		const missed: Snowflake[] = [];

		let index = 0;

		for (const { id: targetId, tag: targetTag } of members) {
			promises.push(
				this.rest
					.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${interaction.guild_id}/cases`, [
						{
							action: ban ? CaseAction.ban : CaseAction.kick,
							mod_id: interaction.member.user.id,
							mod_tag: `${interaction.member.user.username}#${interaction.member.user.discriminator}`,
							target_id: targetId,
							target_tag: targetTag,
							reason: `Raid cleanup (${++index}/${members.length})`,
							created_at: new Date(),
							delete_message_days: ban ? 1 : undefined,
							execute: true,
						},
					])
					.then(([cs]) => {
						cases.push(cs!);
						sweeped.push(targetId);
					})
					.catch((error: unknown) => {
						this.logger.debug({ error, targetId, targetTag, guild: interaction.guild_id }, 'Failed to sweep a member');
						missed.push(targetId);
					}),
			);
		}

		await Promise.allSettled(promises);

		this.guildLogs.publish({
			type: LogTypes.modAction,
			data: cases,
		});

		const format = (xs: Snowflake[]) => (xs.length ? `\n${xs.map((x) => `• <@${x}>`).join('\n')}` : ' none');

		return send(
			interaction,
			{
				content: `Done cleaning up! Here's a summary:\n\n**Members sweeped**:${format(
					sweeped,
				)}\n\n**Members missed**:${format(missed)}`,
				allowed_mentions: { parse: [] },
			},
			InteractionResponseType.ChannelMessageWithSource,
			true,
		);
	}
}
