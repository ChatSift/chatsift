import type { PunishmentsCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { WarnPunishment, WarnPunishmentAction } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';

@injectable()
export default class implements Command {
	public readonly userPermissions = UserPerms.admin;

	public constructor(public readonly rest: Rest, @inject(kSql) public readonly sql: Sql<{}>) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof PunishmentsCommand>) {
		switch (Object.keys(args)[0] as 'add' | 'delete' | 'list') {
			case 'add': {
				const data: WarnPunishment = {
					guild_id: interaction.guild_id,
					warns: args.add.count,
					action_type: args.add.punishment,
					duration: null,
				};

				if (args.add.duration) {
					if (data.action_type === WarnPunishmentAction.kick) {
						throw new ControlFlowError('Cannot set a duration for kicks');
					}

					data.duration = args.add.duration;
				}

				await this.sql`
          INSERT INTO warn_punishments ${this.sql(data)}
          ON CONFLICT (guild_id, warns)
          DO UPDATE SET duration = ${data.duration}
        `;

				return send(interaction, {
					content: `A punishment will now trigger at ${data.warns}, causing a ${WarnPunishmentAction[
						data.action_type
					]!}`,
				});
			}

			case 'delete': {
				const [punishment] = await this.sql<[WarnPunishment?]>`
          DELETE FROM warn_punishments
          WHERE guild_id = ${interaction.guild_id}
            AND warns = ${args.delete.count}
          RETURNING *
        `;

				if (!punishment) {
					throw new ControlFlowError('Could not find a punishment to delete');
				}

				return send(interaction, {
					content: `Successfully deleted the punishment triggered at ${args.delete.count} warns`,
				});
			}

			case 'list': {
				const punishments = await this.sql<
					WarnPunishment[]
				>`SELECT * FROM warn_punishments WHERE guild_id = ${interaction.guild_id}`.then((rows) =>
					rows.map(
						(p) =>
							`• At ${p.warns} warns, a ${WarnPunishmentAction[p.action_type]!} will be triggered${
								p.duration ? ` which will last ${p.duration} minutes` : ''
							}`,
					),
				);

				return send(interaction, {
					content: punishments.length
						? `List of punishments:\n${punishments.join('\n')}`
						: 'There are currently no punishments',
				});
			}
		}
	}
}
