import type { ApiPostFiltersUrlsBody, ApiPostFiltersUrlsResult, MaliciousUrl } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { kLogger } from '@automoderator/injection';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import fetch from 'node-fetch';

@singleton()
export class GlobalsRunner {
  public readonly fishUrl = 'http://api.phish.surf/gimme-domains' as const;
  public readonly fishCache = new Set<string>();
  public lastRefreshedFish: number | null = null;

  public constructor(
    public readonly rest: Rest,
    @inject(kLogger) public readonly logger: Logger
  ) {
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
    this.logger.debug({ url, replaced: url.split('/')[0] });
    return this.fishCache.has(url.split('/')[0]!);
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
