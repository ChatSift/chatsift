import type { ApiPostFiltersUrlsBody, ApiPostFiltersUrlsResult, MaliciousUrl } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { kLogger } from '@automoderator/injection';
import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import fetch from 'node-fetch';

@singleton()
export class UrlsRunner {
  public readonly urlRegex = /([^\.\s\/]+\.)+(?<tld>[^\.\s\/]+)(?<url>\/[^\s]*)?/gm;
  public readonly tlds: Set<string>;

  public readonly fishUrl = 'http://api.phish.surf:5000/gimme-domains' as const;
  public readonly fishCache = new Set<string>();
  public lastRefreshedFish: number | null = null;

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

    void this.refreshFish();
  }

  private async refreshFish() {
    if (this.lastRefreshedFish && Date.now() - this.lastRefreshedFish < 6e4) {
      return;
    }

    const res = await fetch(this.fishUrl).catch(() => null);
    const domains = await res?.json().catch(() => null);

    if (!domains) {
      this.logger.warn('Something went wrong grabbing fish data');
      return;
    }

    this.lastRefreshedFish = Date.now();
    this.fishCache.clear();

    for (const domain of domains) {
      this.fishCache.add(domain);
    }
  }

  private async isForbiddenByFish(url: string): Promise<boolean> {
    await this.refreshFish();
    return this.fishCache.has(url);
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

  public async run(urls: string[]) {
    const hits = new Map<string, MaliciousUrl | { url: string }>();

    const builtIn = await this.rest.post<ApiPostFiltersUrlsResult, ApiPostFiltersUrlsBody>('/filters/urls', { urls });
    for (const hit of builtIn) {
      hits.set(hit.url, hit);
    }

    const isForbiddenByFish = await Promise.all(urls.map(url => this.isForbiddenByFish(url)));
    for (let i = 0; i < urls.length; i++) {
      if (isForbiddenByFish[i]) {
        hits.set(urls[i]!, { url: urls[i]! });
      }
    }

    return [...hits.values()];
  }
}
