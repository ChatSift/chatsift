import { readFileSync } from 'fs';
import { singleton, inject } from 'tsyringe';
import { join as joinPath } from 'path';
import { IRouter, kRestRouter } from '@automoderator/http-client';
import type { ApiPostFiltersUrlsResult, ApiPostFiltersUrlsBody } from '@automoderator/core';

@singleton()
export class UrlsModule {
  public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\/]+)(?<url>\/[^\s]*)?/gm;
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

  public precheck(content: string): string | null {
    const matches = this.urlRegex.exec(content);
    if (!matches) return null;

    const { tld } = matches.groups!;
    if (!this.tlds.has(tld!)) return null;

    return matches[0]!;
  }

  public run(urls: string[]) {
    return this.router.api!.v1!.filters!.urls!.post<ApiPostFiltersUrlsResult, ApiPostFiltersUrlsBody>({ urls });
  }
}
