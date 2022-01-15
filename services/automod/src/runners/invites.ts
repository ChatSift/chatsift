import type { AllowedInvite } from '@automoderator/core';
import { kLogger, kRedis, kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import type { Snowflake, APIInvite } from 'discord-api-types/v9';
import type { Redis } from 'ioredis';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';
import fetch from 'node-fetch';
import type { Logger } from 'pino';

@singleton()
export class InvitesRunner {
	public readonly inviteRegex =
		/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)(?<code>[\w\d-]{2,})/gi;

	public readonly invitesWorkerDomain = 'https://invite-lookup.chatsift.workers.dev' as const;

	public constructor(
		@inject(kSql) public readonly sql: Sql<{}>,
		@inject(kRedis) public readonly redis: Redis,
		@inject(kLogger) public readonly logger: Logger,
		public readonly discordRest: Rest,
	) {}

	private async fetchInvite(code: string): Promise<APIInvite | null> {
		const res = await fetch(`${this.invitesWorkerDomain}/invites/${code}`);

		if (!res.ok) {
			if (res.status !== 404) {
				this.logger.warn(
					{
						code,
						res,
						data: (await res
							.clone()
							.json()
							.catch(() => null)) as unknown,
					},
					'Failed to fetch invite',
				);
			}

			return null;
		}

		return res.json() as Promise<APIInvite>;
	}

	public precheck(content: string): string[] {
		const invites = new Set([...content.matchAll(this.inviteRegex)].map((match) => match.groups!.code!));
		return [...invites];
	}

	public async run(codes: string[], guildId: Snowflake): Promise<string[]> {
		const allowlist = new Set(
			await this.sql<AllowedInvite[]>`SELECT * FROM allowed_invites WHERE guild_id = ${guildId}`.then((rows) =>
				rows.map((row) => row.allowed_guild_id),
			),
		);

		const invites = await Promise.all(codes.map((code) => this.fetchInvite(code)));

		return invites.reduce<string[]>((acc, invite) => {
			if (invite && !allowlist.has(invite.guild!.id)) {
				acc.push(invite.code);
			}

			return acc;
		}, []);
	}
}
