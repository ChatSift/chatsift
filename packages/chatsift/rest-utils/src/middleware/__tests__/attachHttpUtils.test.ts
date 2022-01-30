import { attachHttpUtils } from '../attachHttpUtils';
import { Http2ServerResponse } from 'http2';
import type { Request, Response } from 'polka';

jest.mock('http2');

const MockedRequest = {} as unknown as Request;
const MockedResponse = Http2ServerResponse as unknown as jest.Mock<Response>;
const next = jest.fn();

afterEach(() => jest.clearAllMocks());

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
		(res.getHeader as jest.Mock).mockReturnValueOnce('test');
		res.append('X-Test', 'test2');

		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenNthCalledWith(2, 'X-Test', ['test', 'test2']);
	});

	test('header did exist prior with array', async () => {
		const res = new MockedResponse();
		await middleware(MockedRequest, res, next);

		res.append('X-Test', ['test', 'test2']);
		(res.getHeader as jest.Mock).mockReturnValueOnce(['test', 'test2']);
		res.append('X-Test', 'test3');

		expect(res.setHeader).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenNthCalledWith(2, 'X-Test', ['test', 'test2', 'test3']);
	});
});

test('redirecting', async () => {
	const res = new MockedResponse();
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
