import { BanwordFlags } from '@automoderator/banword-flags';
import type { BannedWord } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { APIMessage } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';
import { UrlsRunner } from './urls';

type BannedWordWithFlags = Omit<BannedWord, 'flags'> & { flags: BanwordFlags; isUrl: boolean };

@singleton()
export class WordsRunner {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>,
    public readonly urlsRunner: UrlsRunner
  ) {}

  public async run(message: APIMessage): Promise<BannedWordWithFlags[]> {
    const entries = await this.sql<BannedWord[]>`SELECT * FROM banned_words WHERE guild_id = ${message.guild_id!}`;
    const content = message.content.toLowerCase();
    const wordsArray = content.split(/ +/g);

    const out: BannedWordWithFlags[] = [];

    for (const entry of entries) {
      const flags = new BanwordFlags(BigInt(entry.flags));
      const computed: BannedWordWithFlags = {
        ...entry,
        flags,
        isUrl: Boolean(this.urlsRunner.precheck(entry.word).length)
      };

      if (flags.has('name')) {
        continue;
      }

      if (flags.has('word')) {
        if (wordsArray.includes(entry.word)) {
          out.push(computed);
        }
      } else if (content.includes(entry.word)) {
        out.push(computed);
      }
    }

    return out;
  }
}
