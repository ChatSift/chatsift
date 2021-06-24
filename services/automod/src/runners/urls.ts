import { readFileSync } from 'fs';
import { singleton, inject } from 'tsyringe';
import { join as joinPath } from 'path';
import { IRouter, kRestRouter } from '@automoderator/http-client';
import type { ApiPostFiltersUrlsResult, ApiPostFiltersGuildUrlBody } from '@automoderator/core';

@singleton()
export class UrlsRunner {
  public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
  public readonly tlds: Set<string>;

  public constructor(
    @inject(kRestRouter) public readonly router: IRouter
  ) {
    const contents = readFileSync(joinPath(__dirname, '..', '..', 'tlds.txt'), 'utf8');
    this.tlds = contents
      .split('\n')
      .reduce((acc, line) => {
        if (!line.startsWith('#')) {
          acc.add(line);
        }

        return acc;
      }, new Set<string>());
  }

  public precheck(content: string): string[] {
    return [...content.matchAll(this.urlRegex)].reduce<string[]>((acc, match) => {
      if (this.tlds.has(match.groups!.tld!)) {
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
