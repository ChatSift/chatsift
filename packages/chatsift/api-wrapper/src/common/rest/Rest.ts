import fetch from 'node-fetch';
import { HTTPError } from './HTTPError';

/**
 * HTTP client for making requests to the AutoModerator API
 */
export class Rest {
	public constructor(private readonly apiDomain: string, private readonly apiToken: string) {}

	/**
	 * Makes an API request to the given path
	 * @param path Given path - `/` needs to be included at the beginning
	 * @param method HTTP method to use
	 * @param data Optional data to send into the body
	 */
	public async make<T, D = never>(
		path: string,
		method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
		data?: D,
	): Promise<T> {
		const res = await fetch(`${this.apiDomain}/api/v1${path}`, {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `App ${this.apiToken}`,
			},
			method,
			body: JSON.stringify(data),
			timeout: 15e3,
		});

		if (!res.ok) {
			const clone = res.clone();

			const error = await (res.json() as Promise<{ message?: string }>).catch(() => null);
			const message = error?.message ?? (await clone.text());

			return Promise.reject(new HTTPError(res, res.status, message));
		}

		return res.json() as Promise<T>;
	}

	/**
	 * Makes a GET request to the given path
	 */
	public get<T>(path: string): Promise<T> {
		return this.make<T>(path, 'GET');
	}

	/**
	 * Makes a POST request to the given path
	 */
	public post<T, D>(path: string, data: D): Promise<T> {
		return this.make<T, D>(path, 'POST', data);
	}

	/**
	 * Makes a PATCH request to the given path
	 */
	public patch<T, D>(path: string, data: D): Promise<T> {
		return this.make<T, D>(path, 'PATCH', data);
	}

	/**
	 * Makes a PUT request to the given path
	 */
	public put<T, D = never>(path: string, data?: D): Promise<T> {
		return this.make<T, D>(path, 'PUT', data);
	}

	/**
	 * Makes a DELETE request to the given path
	 */
	public delete<T, D = never>(path: string, data?: D): Promise<T> {
		return this.make<T, D>(path, 'DELETE', data);
	}
}
