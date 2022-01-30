import type { Response } from 'node-fetch';

/**
 * HTTP error thrown by the API
 */
export class HTTPError extends Error {
	public constructor(
		/**
		 * Clone of the response object
		 */
		public readonly response: Response,
		/**
		 * Status code given back
		 */
		public readonly statusCode: number,
		/**
		 * "Body" - as in error message reported
		 */
		public readonly body: string,
	) {
		super(`${response.statusText}: ${body}`);
	}
}
