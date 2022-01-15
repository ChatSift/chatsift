import { Config, kConfig } from '@automoderator/injection';
import fetch from 'node-fetch';
import { inject, injectable } from 'tsyringe';
import { HTTPError } from './HTTPError';
import type { IRest } from './IRest';

/**
 * HTTP client for making requests to the Automoderator API (backend only)
 */
@injectable()
export class Rest implements IRest {
  public constructor(
    @inject(kConfig) public readonly config: Config
  ) {}

  public async make<T, D = never>(path: string, method: string, data?: D): Promise<T> {
    const res = await fetch(`${this.config.apiDomain}/api/v1${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `App ${this.config.internalApiToken}`
      },
      method,
      body: JSON.stringify(data),
      timeout: 15e3
    });

    if (!res.ok) {
      const error = await res.json().catch(() => null);
      const message = error?.message ?? await res.text();

      return Promise.reject(new HTTPError(res, res.status, message));
    }

    return res.json();
  }

  public get<T>(path: string): Promise<T> {
    return this.make<T>(path, 'GET');
  }

  public post<T, D>(path: string, data: D): Promise<T> {
    return this.make<T, D>(path, 'POST', data);
  }

  public patch<T, D>(path: string, data: D): Promise<T> {
    return this.make<T, D>(path, 'PATCH', data);
  }

  public put<T, D = never>(path: string, data?: D): Promise<T> {
    return this.make<T, D>(path, 'PUT', data);
  }

  public delete<T, D = never>(path: string, data?: D): Promise<T> {
    return this.make<T, D>(path, 'DELETE', data);
  }
}
