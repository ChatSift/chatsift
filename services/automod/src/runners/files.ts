import { singleton, inject } from 'tsyringe';
import { Rest } from '@automoderator/http-client';
import fetch from 'node-fetch';
import { kLogger } from '@automoderator/injection';
import { createHash } from 'crypto';
import type { ApiPostFiltersFilesBody, ApiPostFiltersFilesResult } from '@automoderator/core';
import type { Logger } from 'pino';

@singleton()
export class FilesRunner {
  public constructor(
    public readonly rest: Rest,
    @inject(kLogger) public readonly logger: Logger
  ) {}

  private async cdnUrlToHash(url: string): Promise<string> {
    const buffer = await fetch(url, { timeout: 15e3 }).then(res => res.buffer());
    const hash = createHash('sha256')
      .update(buffer)
      .digest('hex');

    return hash;
  }

  public async run(urls: string[]): Promise<ApiPostFiltersFilesResult> {
    const hashes: string[] = [];
    const promises: Promise<string>[] = urls.map(url => this.cdnUrlToHash(url));

    for (const promise of await Promise.allSettled(promises)) {
      if (promise.status === 'rejected') {
        this.logger.error({ topic: 'FILES RUNNER FETCH FILE', e: promise.reason }, 'Failed to fetch the contents of a file');
        continue;
      }

      const hash = createHash('sha256')
        .update(promise.value)
        .digest('hex');

      hashes.push(hash);
    }

    return this.rest.post<ApiPostFiltersFilesResult, ApiPostFiltersFilesBody>('/api/v1/filters/files', { hashes });
  }
}
