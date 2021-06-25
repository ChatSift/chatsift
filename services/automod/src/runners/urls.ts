import { readFileSync } from 'fs';
import { singleton, inject } from 'tsyringe';
import { join as joinPath } from 'path';
import { IRouter, kRestRouter } from '@automoderator/http-client';
import { kLogger } from '@automoderator/injection';
import type { ApiPostFiltersUrlsResult, ApiPostFiltersGuildUrlBody } from '@automoderator/core';
import type { Logger } from 'pino';

@singleton()
export class UrlsRunner {
  public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
  public readonly tlds: Set<string>;

  public constructor(
    @inject(kRestRouter) public readonly router: IRouter,
    @inject(kLogger) public readonly logger: Logger
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

    logger.trace({ tlds: [...this.tlds] }, 'Successfully computed valid tlds');
  }

  public precheck(content: string): string[] {
    return [...content.matchAll(this.urlRegex)].reduce<string[]>((acc, match) => {
      if (this.tlds.has(match.groups!.tld!.toLowerCase())) {
        acc.push(match[0]!);
      }

      return acc;
    }, []);
  }

  public run(urls: string[], guildId: string, guildOnly: boolean) {
    return this.router.api!.v1!.filters!.urls![guildId]!.post<ApiPostFiltersUrlsResult, ApiPostFiltersGuildUrlBody>({
      urls,
      guild_only: guildOnly
    });
  }
}
