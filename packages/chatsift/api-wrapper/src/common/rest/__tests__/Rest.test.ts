/* eslint-disable @typescript-eslint/no-unsafe-return */

import fetch, { ResponseInit } from 'node-fetch';
import { Rest } from '../Rest';
import { HTTPError } from '../HTTPError';

jest.mock('node-fetch');
const mockedFetch = fetch as unknown as jest.Mock<any, [url: string, init?: ResponseInit]>;

afterEach(() => mockedFetch.mockClear());

const rest = new Rest('https://example.com', 'abc');

test('ok requests', async () => {
	mockedFetch.mockImplementation(() => ({ ok: true, json: () => Promise.resolve({ hello: 'world' }) }));

	expect(await rest.get('/')).toStrictEqual({ hello: 'world' });
	expect(await rest.post('/', { a: 'b' })).toStrictEqual({ hello: 'world' });
	expect(await rest.patch('/', { a: 'b' })).toStrictEqual({ hello: 'world' });
	expect(await rest.put('/', { a: 'b' })).toStrictEqual({ hello: 'world' });
	expect(await rest.delete('/')).toStrictEqual({ hello: 'world' });
});

test('bad request', async () => {
	mockedFetch.mockImplementation(() => ({
		ok: false,
		status: 500,
		statusText: 'Internal Server Error',
		json: () => Promise.resolve({ message: 'made a fucko wucko' }),
		clone: function clone() {
			return this;
		},
	}));

	await expect(() => rest.make('/', 'GET')).rejects.toThrow(HTTPError);
});

test('bad request with non-json body', async () => {
	mockedFetch.mockImplementation(() => ({
		json: () => Promise.reject(),
		text: () => 'Internal Server Error',
		clone: function clone() {
			return this;
		},
	}));

	await expect(() => rest.make('/', 'GET')).rejects.toThrow(HTTPError);
});
