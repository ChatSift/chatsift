/* eslint-disable @typescript-eslint/unbound-method */

import { Http2ServerResponse } from 'node:http2';
import type { Request, Response } from 'polka';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { attachHttpUtils } from '../attachHttpUtils.js';

vi.mock('http2');

const MockedRequest = {} as unknown as Request;
const MockedResponse = Http2ServerResponse as unknown as new () => Response;
const next = vi.fn();

afterEach(() => {
	vi.resetAllMocks();
});

const middleware = attachHttpUtils();

test('it attaches the methods', async () => {
	const res = new MockedResponse();
	await middleware(MockedRequest, res, next);

	expect(res.append).toStrictEqual(expect.any(Function));
	expect(res.redirect).toStrictEqual(expect.any(Function));
	expect(res.cookie).toStrictEqual(expect.any(Function));
	expect(next).toHaveBeenCalled();
});

describe('header appending', () => {
	test("header didn't exist prior", async () => {
		const res = new MockedResponse();
		await middleware(MockedRequest, res, next);

		res.append('X-Test', 'test');
		expect(res.setHeader).toHaveBeenCalled();
		expect(res.setHeader).toHaveBeenCalledWith('X-Test', 'test');
	});

	test('header did exist prior', async () => {
		const res = new MockedResponse();
		await middleware(MockedRequest, res, next);

		res.append('X-Test', 'test');
		(res.getHeader as Mock).mockReturnValueOnce('test');
		res.append('X-Test', 'test2');

		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenNthCalledWith(2, 'X-Test', ['test', 'test2']);
	});

	test('header did exist prior with array', async () => {
		const res = new MockedResponse();
		await middleware(MockedRequest, res, next);

		res.append('X-Test', ['test', 'test2']);
		(res.getHeader as Mock).mockReturnValueOnce(['test', 'test2']);
		res.append('X-Test', 'test3');

		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenNthCalledWith(2, 'X-Test', ['test', 'test2', 'test3']);
	});
});

test('redirecting', async () => {
	const res = new MockedResponse();
	// Hack because vitest is wiping http2 internals and causing any access to statusCode to throw
	Object.defineProperty(res, 'statusCode', {
		writable: true,
		enumerable: true,
		configurable: true,
	});

	await middleware(MockedRequest, res, next);

	res.redirect('https://example.com');
	expect(res.setHeader).toHaveBeenCalledTimes(2);
	expect(res.statusCode).toBe(302);
	expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Location', 'https://example.com');
	expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Content-Length', 0);
});

test('cookie', async () => {
	const res = new MockedResponse();
	await middleware(MockedRequest, res, next);

	res.cookie('test', 'test', {});
	expect(res.setHeader).toHaveBeenCalled();
	expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', 'test=test');
});

test('cookie overwriting', async () => {
	const res = new MockedResponse();
	await middleware(MockedRequest, res, next);

	res.cookie('test', 'test', {});
	res.cookie('test', 'newvalue', {});

	expect(res.setHeader).toHaveBeenCalledTimes(2);
	expect(res.setHeader).toHaveBeenNthCalledWith(1, 'Set-Cookie', 'test=test');
	expect(res.setHeader).toHaveBeenNthCalledWith(2, 'Set-Cookie', 'test=newvalue');
});
