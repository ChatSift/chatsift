import type { ApiPostFiltersFilesBody, ApiPostFiltersFilesResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { kLogger } from '@automoderator/injection';
import { createHash } from 'crypto';
import fetch from 'node-fetch';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

@singleton()
export class FilesRunner {
  public readonly extensions = new Set([
    'exe',
    'wav',
    'mp3',
    'flac',
    'apng',
    'gif',
    'ogg',
    'mp4',
    'avi',
    'webp'
  ]);

  public constructor(
    public readonly rest: Rest,
    @inject(kLogger) public readonly logger: Logger
  ) {}

  private async cdnUrlToHash(url: string): Promise<string> {
    const buffer = await fetch(url, { timeout: 15e3, follow: 5 }).then(res => res.buffer());
    const hash = createHash('sha256')
      .update(buffer)
      .digest('hex');

    return hash;
  }

  public precheck(urls: string[]): string[] {
    return urls.filter(url => this.extensions.has(url.split('.').pop() ?? ''));
  }

  public async run(urls: string[]): Promise<ApiPostFiltersFilesResult> {
    const hashes: string[] = [];
    const promises: Promise<string>[] = urls.map(url => this.cdnUrlToHash(url));

    for (const promise of await Promise.allSettled(promises)) {
      if (promise.status === 'rejected') {
        this.logger.error({ e: promise.reason }, 'Failed to fetch the contents of a file');
        continue;
      }

      const hash = createHash('sha256')
        .update(promise.value)
        .digest('hex');

      hashes.push(hash);
    }

    if (!hashes.length) {
      return [];
    }

    return this.rest.post<ApiPostFiltersFilesResult, ApiPostFiltersFilesBody>('/filters/files', { hashes });
  }
}
