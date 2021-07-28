import { singleton, inject } from 'tsyringe';
import { kSql } from '@automoderator/injection';
import { BanwordFlags } from '@automoderator/banword-flags';
import type { APIMessage } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import type { BannedWord } from '@automoderator/core';

@singleton()
export class WordsRunner {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async run(message: APIMessage): Promise<(Omit<BannedWord, 'flags'> & { flags: BanwordFlags }) | null> {
    const entries = await this.sql<BannedWord[]>`SELECT * FROM banned_words WHERE guild_id = ${message.guild_id!}`;
    const wordsArray = message.content.split(/ +/g);

    for (const entry of entries) {
      const flags = new BanwordFlags(BigInt(entry.flags));
      const out = { ...entry, flags };

      if (flags.has('word')) {
        if (wordsArray.includes(entry.word)) {
          return out;
        }
      } else if (message.content.includes(entry.word)) {
        return out;
      }
    }

    return null;
  }
}
