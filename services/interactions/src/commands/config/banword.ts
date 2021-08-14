import { BanwordCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { BanwordFlags, BanwordFlagsResolvable } from '@automoderator/banword-flags';
import type { BannedWord } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { kLogger, kSql } from '@automoderator/injection';
import { File, Rest } from '@cordis/rest';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import yaml from 'js-yaml';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

interface ParsedEntry {
  muteduration?: number;
  flags: ('word' | 'warn' | 'mute' | 'ban')[];
}

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger
  ) {}

  private _entriesToYaml(list: BannedWord[]): string {
    const data = list.reduce<Record<string, ParsedEntry>>((acc, entry) => {
      const value: ParsedEntry = {
        flags: new BanwordFlags(BigInt(entry.flags)).toArray()
      };

      if (entry.duration !== null) {
        value.muteduration = entry.duration;
      }

      acc[entry.word] = value;
      return acc;
    }, {});

    return yaml.dump(data, { sortKeys: true, schema: yaml.JSON_SCHEMA });
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof BanwordCommand>) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'add': {
        const flags: BanwordFlagsResolvable = [];

        if (args.add.word) {
          flags.push('word');
        }

        if (args.add.warn) {
          flags.push('warn');
        }

        if (args.add.mute) {
          flags.push('mute');
        }

        if (args.add.ban) {
          flags.push('ban');
        }

        const url = args.add.entry.match(/([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm)?.[0];

        const bannedWord: BannedWord = {
          guild_id: interaction.guild_id,
          word: (url ?? args.add.entry).toLowerCase(),
          // TODO look into making BitField#toJSON return `${bigint}` for whenever I release cordis 1.0.2
          flags: new BanwordFlags(flags).toJSON() as `${bigint}`,
          duration: null
        };

        if (args.add.muteduration !== undefined) {
          if (!args.add.mute) {
            throw new ControlFlowError('You can only provide a mute duration for triggers that cause a mute');
          }

          bannedWord.duration = args.add.muteduration;
        }

        await this.sql`
          INSERT INTO banned_words ${this.sql(bannedWord)}
          ON CONFLICT (guild_id, word)
          DO UPDATE SET ${this.sql(bannedWord)}
        `;

        return send(interaction, { content: 'Successfully banned the given word/phrase' });
      }

      case 'remove': {
        const url = args.remove.entry.match(/([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm)?.[0];

        const [deleted] = await this.sql<[BannedWord?]>`
          DELETE FROM banned_words
          WHERE guild_id = ${interaction.guild_id}
            AND word = ${(url ?? args.remove.entry).toLowerCase()}
          RETURNING *
        `;

        if (!deleted) {
          throw new ControlFlowError('There was nothing to remove');
        }

        return send(interaction, { content: 'Successfully removed the given word/phrase from the list' });
      }

      case 'list': {
        const list = await this.sql<BannedWord[]>`SELECT * FROM banned_words WHERE guild_id = ${interaction.guild_id}`;

        if (!list.length) {
          return send(interaction, { content: 'There is currently nothing on your banned words list' });
        }

        return send(interaction, {
          content: 'Here\'s your list',
          files: [{ name: 'bannedwords.yml', content: Buffer.from(this._entriesToYaml(list)) }]
        });
      }

      case 'bulk': {
        const text = await fetch(args.bulk.list)
          .then(res => res.text())
          .catch(() => null);

        if (!text) {
          throw new ControlFlowError('Failed to fetch the given list');
        }

        let parsed;
        try {
          parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA, json: true }) as Record<string, ParsedEntry> | null;
        } catch (error: any) {
          this.logger.error({ error });
          throw new ControlFlowError(
            `You have a syntax error in your YML file - are you sure you didn't send something else?\n\`${error.message}\``
          );
        }

        if (!parsed) {
          this.logger.debug({ parsed }, 'Failed yml parse object check');
          throw new ControlFlowError('Something is wrong with your yml file - expected a top level object');
        }

        const words: BannedWord[] = [];
        for (const [word, value] of Object.entries(parsed)) {
          let bitfield: BanwordFlags;
          try {
            bitfield = new BanwordFlags(value.flags);
          } catch (error: any) {
            throw new ControlFlowError(`You provided an invalid flag for \`${word}\`\n${error.message}`);
          }

          const entry: BannedWord = {
            guild_id: interaction.guild_id,
            word,
            flags: bitfield.toJSON() as `${bigint}`,
            duration: null
          };

          if (value.muteduration !== undefined) {
            if (!bitfield.has('mute')) {
              throw new ControlFlowError('You provided a mute time but no mute flag');
            }

            if (typeof value.muteduration !== 'number') {
              throw new ControlFlowError('Please provide a valid number for your mute duration');
            }

            entry.duration = value.muteduration;
          }

          words.push(entry);
        }

        const files: File[] = [];

        const oldEntries = await this.sql<BannedWord[]>`SELECT * FROM banned_words WHERE guild_id = ${interaction.guild_id}`;
        if (oldEntries.length) {
          files.push({
            name: 'oldlist.yml',
            content: Buffer.from(this._entriesToYaml(oldEntries))
          });
        }

        const newEntries = await this.sql.begin<BannedWord[]>(async sql => {
          await sql`DELETE FROM banned_words WHERE guild_id = ${interaction.guild_id}`;
          return sql`INSERT INTO banned_words ${sql(words)} RETURNING *`;
        });

        if (!newEntries.length) {
          return send(interaction, {
            content: 'Done! All though there is nothing to display, as your list is now empty',
            files
          });
        }

        files.push({
          name: 'newlist.yml',
          content: Buffer.from(this._entriesToYaml(newEntries))
        });

        return send(interaction, { content: 'Successfully updated your list in bulk', files });
      }
    }
  }
}
