import { container } from 'tsyringe';
import { kConfig } from '@automoderator/injection';
import { Rest, HTTPError } from '../';
import fetch, { ResponseInit } from 'node-fetch';

jest.mock('node-fetch');
const mockedFetch = fetch as unknown as jest.Mock<any, [url: string, init?: ResponseInit]>;

afterEach(() => mockedFetch.mockClear());

container.register(kConfig, { useValue: { apiDomain: 'https://example.com', internalApiToken: 'abc' } });
const rest = container.resolve(Rest);

test('ok requests', async () => {
  mockedFetch.mockImplementation(
    () => ({ ok: true, json: () => Promise.resolve({ hello: 'world' }) })
  );

  expect(await rest.get('/')).toStrictEqual({ hello: 'world' });
  expect(await rest.post('/', { a: 'b' })).toStrictEqual({ hello: 'world' });
  expect(await rest.patch('/', { a: 'b' })).toStrictEqual({ hello: 'world' });
  expect(await rest.put('/', { a: 'b' })).toStrictEqual({ hello: 'world' });
  expect(await rest.delete('/')).toStrictEqual({ hello: 'world' });
});

test('bad request', async () => {
  mockedFetch.mockImplementation(
    () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'made a fucko wucko' })
    })
  );

  await expect(() => rest.make('/', 'get'))
    .rejects
    .toThrow(HTTPError);
});
