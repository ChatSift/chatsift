import { send } from '#util';
import { BanwordFlags } from '@automoderator/banword-flags';
import {
	ApiGetGuildsSettingsResult,
	ApiPostGuildsCasesBody,
	ApiPostGuildsCasesResult,
	BannedWord,
	CaseAction,
	Log,
	LogTypes,
} from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Config, kConfig, kSql } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import {
	APIEmbed,
	APIGuildMember,
	APIGuildInteraction,
	InteractionResponseType,
	APIButtonComponent,
	ComponentType,
	RESTPatchAPIGuildMemberJSONBody,
	Snowflake,
	Routes,
} from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import type { Component } from '../component';

@injectable()
export default class implements Component {
	public constructor(
		public readonly rest: Rest,
		public readonly discordRest: DiscordRest,
		public readonly guildLogs: PubSubPublisher<Log>,
		@inject(kSql) public readonly sql: Sql<{}>,
		@inject(kConfig) public readonly config: Config,
	) {}

	private async _filter(guildId: string, userId: Snowflake, embed?: APIEmbed) {
		const foundWords = embed?.footer?.text.split(': ')[1]?.split(', ') ?? [];
		const member = await this.discordRest.get<APIGuildMember>(Routes.guildMember(guildId, userId)).catch(() => null);
		const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${guildId}/settings`);

		const allWords = await this.sql<BannedWord[]>`SELECT * FROM banned_words WHERE guild_id = ${guildId}`.then(
			(words) => new Map(words.map((word) => [word.word, word])),
		);

		if (!foundWords.length || !member) {
			return;
		}

		let name = member.nick ?? member.user!.username;

		let warned = false;
		let muted = false;
		let banned = false;

		for (const word of foundWords) {
			const entry = allWords.get(word);
			if (!entry) {
				continue;
			}

			const hit = { ...entry, flags: new BanwordFlags(BigInt(entry.flags)) };

			const caseData: ApiPostGuildsCasesBody = [];
			const unmuteRoles: Snowflake[] = [];

			const reason = `automated punishment triggered for having ${hit.word} in their username`;

			const caseBase = {
				mod_id: this.config.discordClientId,
				mod_tag: 'AutoModerator#0000',
				reason,
				target_id: member.user!.id,
				target_tag: `${member.user!.username}#${member.user!.discriminator}`,
				created_at: new Date(),
				execute: true,
			};

			if (hit.flags.has('warn') && !warned && !banned) {
				warned = true;
				caseData.push({ action: CaseAction.warn, ...caseBase });
			}

			if (hit.flags.has('mute') && settings.mute_role && !muted && !banned) {
				muted = true;
				unmuteRoles.concat([...member.roles]);

				let expiresAt: Date | undefined;
				if (hit.duration) {
					expiresAt = new Date(Date.now() + hit.duration * 6e4);
				}

				caseData.push({ action: CaseAction.mute, expires_at: expiresAt, ...caseBase });
			}

			if (hit.flags.has('ban') && !banned) {
				banned = true;
				caseData.push({ action: CaseAction.ban, ...caseBase });
			}

			if (caseData.length) {
				const cases = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
					`/guilds/${guildId}/cases`,
					caseData,
				);

				this.guildLogs.publish({
					data: cases,
					type: LogTypes.modAction,
				});
			}

			name = name.replace(new RegExp(hit.word, 'gi'), '');
		}

		await this.discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(
			Routes.guildMember(guildId, member.user!.id),
			{
				data: {
					nick: name,
				},
			},
		);
	}

	public async exec(interaction: APIGuildInteraction, [action, userId]: [string, string]) {
		const [filter, actioned, acknowledged] = interaction.message!.components![0]!.components as [
			APIButtonComponent,
			APIButtonComponent,
			APIButtonComponent,
		];
		const [embed] = interaction.message!.embeds;

		if (action === 'filter') {
			filter.disabled = true;
			actioned.disabled = true;
			void this._filter(interaction.guild_id, userId, embed);
		} else if (action === 'action') {
			actioned.disabled = true;
		} else if (action === 'acknowledge') {
			acknowledged.disabled = true;
		}

		return send(
			interaction,
			{
				components: [
					{
						type: ComponentType.ActionRow,
						components: [filter, actioned, acknowledged],
					},
				],
				embed: embed ? { ...embed, color: 2895667 } : undefined,
			},
			InteractionResponseType.UpdateMessage,
		);
	}
}
