import { singleton, inject } from 'tsyringe';
import { kSql } from '@automoderator/injection';
import type { Sql } from 'postgres';
import type { Snowflake } from 'discord-api-types/v9';
import type { AllowedInvite } from '@automoderator/core';

@singleton()
export class InvitesRunner {
  public readonly inviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)(?<code>[\w\d-]{2,})/gi;

  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public precheck(content: string): string[] {
    const invites = new Set([...content.matchAll(this.inviteRegex)].map(match => match.groups!.code!));
    return [...invites];
  }

  public async run(invites: string[], guildId: Snowflake): Promise<string[]> {
    const allowlist = new Set(
      await this
        .sql<AllowedInvite[]>`SELECT * FROM allowed_invites WHERE guild_id = ${guildId}`
        .then(
          rows => rows.map(row => row.invite_code)
        )
    );

    return invites.filter(url => !allowlist.has(url));
  }
}
