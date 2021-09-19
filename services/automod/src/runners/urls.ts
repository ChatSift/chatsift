import { AllowedUrl } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { kLogger, kSql } from '@automoderator/injection';
import { Snowflake } from 'discord-api-types';
import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class UrlsRunner {
  public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
  public readonly tlds: Set<string>;

  public constructor(
    public readonly rest: Rest,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {
    const contents = readFileSync(joinPath(__dirname, '..', '..', 'tlds.txt'), 'utf8');
    this.tlds = contents
      .split('\n')
      .reduce((acc, line) => {
        if (!line.startsWith('#') && line.length) {
          acc.add(line.toLowerCase());
        }

        return acc;
      }, new Set<string>());

    logger.debug({ tlds: [...this.tlds] }, 'Successfully computed valid tlds');
  }

  public precheck(content: string): string[] {
    const urls = [...content.matchAll(this.urlRegex)].reduce<Set<string>>((acc, match) => {
      if (this.tlds.has(match.groups!.tld!.toLowerCase())) {
        acc.add(match[0]!);
      }

      return acc;
    }, new Set());

    return [...urls];
  }

  private addRootFromSub(urls: Set<string>, url: string): void {
    const split = url.split('.');
    // This means that we've got at least 1 subdomain - there could be more nested
    if (split.length > 2) {
      // Extract the root domain
      urls.add(split.slice(split.length - 2, split.length - 1).join('.'));
    }
  }

  private resolveUrls(toResolve: string[]): Set<string> {
    return toResolve.reduce((urls, url) => {
      // Deal with something that contains the path
      if (url.includes('/')) {
        // Assume that the URL is formatted correctly. Extract the domain (including the subdomain)
        const fullDomain = url.split('/')[0]!;
        urls.add(fullDomain);

        // Also add it without a potential subdomain
        this.addRootFromSub(urls, fullDomain);
      } else {
        this.addRootFromSub(urls, url);
      }

      return urls;
    }, new Set(toResolve));
  }

  public async run(urls: string[], guildId: Snowflake) {
    const allowlist = await this
      .sql<AllowedUrl[]>`SELECT * FROM allowed_urls WHERE guild_id = ${guildId}`
      .then(rows => this.resolveUrls(rows.map(row => row.domain)));

    return urls.filter(url => {
      const domains = [...this.resolveUrls([url])];
      return !allowlist.has((domains[1] ?? domains[0])!);
    });
  }
}
