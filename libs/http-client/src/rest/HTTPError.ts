import type { Response } from 'node-fetch';

export class HTTPError extends Error {
  public constructor(
    public readonly response: Response,
    public readonly statusCode: number,
    body: string
  ) {
    super(`${response.statusText}: ${body}`);
  }
}
