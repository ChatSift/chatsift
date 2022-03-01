import type { HistoryCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import type { Case, FilterTrigger, GuildSettings } from '@automoderator/core';
import { makeHistoryEmbed } from '@automoderator/util';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@chatsift/api-wrapper';
import { kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import {
	APIGuildInteraction,
	ApplicationCommandType,
	APIApplicationCommandInteractionData,
} from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.mod;

	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		@inject(kSql) public readonly sql: Sql<{}>,
	) {}

	public parse(args: ArgumentsOf<typeof HistoryCommand>) {
		return {
			member: args.user,
		};
	}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof HistoryCommand>) {
		const { member } = this.parse(args);

		const [settings, cases, filterTriggers] = await this.sql.begin(async (sql) => {
			const [settings] = await sql<
				[GuildSettings?]
			>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;

			const cases = await sql<
				Case[]
			>`SELECT * FROM cases WHERE guild_id = ${interaction.guild_id} AND target_id = ${member.user.id}`;

			const filterTriggers = await sql<[FilterTrigger?]>`
        SELECT count
        FROM filter_triggers
        WHERE guild_id = ${interaction.guild_id}
          AND user_id = ${member.user.id}
      `.then(([triggers]) => triggers?.count ?? 0);

			return [settings, cases, filterTriggers];
		});

		const embed = makeHistoryEmbed({
			user: member.user,
			cases,
			logChannelId: settings?.mod_action_log_channel ?? undefined,
			filterTriggers,
		});

		return send(interaction, {
			embed,
			flags: (interaction.data as APIApplicationCommandInteractionData).type === ApplicationCommandType.User ? 64 : 0,
		});
	}
}
