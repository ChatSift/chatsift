import type { ApiPostFiltersUrlsBody, ApiPostFiltersUrlsResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { kLogger } from '@automoderator/injection';
import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

@singleton()
export class UrlsRunner {
  public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
  public readonly tlds: Set<string>;

  public constructor(
    public readonly rest: Rest,
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

  public run(urls: string[]) {
    return this.rest.post<ApiPostFiltersUrlsResult, ApiPostFiltersUrlsBody>(`/filters/urls`, { urls });
  }
}
