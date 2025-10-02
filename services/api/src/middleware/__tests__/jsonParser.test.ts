import { Http2ServerResponse } from 'node:http2';
import { Boom } from '@hapi/boom';
import type { Request, Response } from 'polka';
import { afterEach, expect, test, vi } from 'vitest';
import { jsonParser } from '../jsonParser.js';

vi.mock('http2');

const makeMockedRequest = (requestInfo: any, data?: any): Request => ({
	setEncoding: vi.fn(),
	*[Symbol.asyncIterator]() {
		yield data;
	},
	...requestInfo,
});

const MockedResponse = Http2ServerResponse as unknown as new () => Response;
const next = vi.fn();

afterEach(() => {
	vi.resetAllMocks();
});

test('missing content type', async () => {
	const parser = jsonParser(false);

	await parser(makeMockedRequest({ headers: {} }), new MockedResponse(), next);
	expect(next).toHaveBeenCalled();
	expect(next.mock.calls[0]![0]).toBeInstanceOf(Boom);
	expect(next.mock.calls[0]![0].output.statusCode).toBe(400);
});

test('invalid data', async () => {
	const parser = jsonParser();

	await parser(makeMockedRequest({ headers: { 'content-type': 'application/json' } }, 'a'), new MockedResponse(), next);
	expect(next).toHaveBeenCalled();
	expect(next.mock.calls[0]![0]).toBeInstanceOf(Boom);
	expect(next.mock.calls[0]![0].output.statusCode).toBe(422);
});

test('empty data', async () => {
	const parser = jsonParser();

	await parser(makeMockedRequest({ headers: { 'content-type': 'application/json' } }, ''), new MockedResponse(), next);
	expect(next).toHaveBeenCalled();
	expect(next.mock.calls[0]![0]).not.toBeInstanceOf(Boom);
});

test('valid data', async () => {
	const parser = jsonParser();

	const data = { foo: 'bar' };
	const req = makeMockedRequest({ headers: { 'content-type': 'application/json' } }, JSON.stringify(data));

	await parser(req, new MockedResponse(), next);
	expect(next).toHaveBeenCalledWith();
	expect(req.body).toStrictEqual(data);
});

test('valid data with raw body', async () => {
	const parser = jsonParser(true);

	const data = { foo: 'bar' };
	const req = makeMockedRequest({ headers: { 'content-type': 'application/json' } }, JSON.stringify(data));

	await parser(req, new MockedResponse(), next);
	expect(next).toHaveBeenCalledWith();
	expect(req.rawBody).toStrictEqual(JSON.stringify(data));
	expect(req.body).toStrictEqual(data);
});
