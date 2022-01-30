import { badRequest, internal, unauthorized } from '@hapi/boom';
import { Http2ServerResponse } from 'http2';
import type { Response } from 'polka';
import { sendBoom } from '../sendBoom';

jest.mock('http2');

const MockedResponse = Http2ServerResponse as unknown as jest.Mock<Response>;

afterEach(() => jest.clearAllMocks());

test('with bad request', () => {
	const error = badRequest();
	const res = new MockedResponse();
	sendBoom(error, res);

	expect(res.statusCode).toBe(400);
	expect(res.setHeader).toHaveBeenCalledTimes(0);
	expect(res.end).toHaveBeenCalledWith('{"statusCode":400,"error":"Bad Request","message":"Bad Request"}');
});

test('with internal server error', () => {
	const error = internal();
	const res = new MockedResponse();
	sendBoom(error, res);

	expect(res.statusCode).toBe(500);
	expect(res.setHeader).toHaveBeenCalledTimes(0);
	expect(res.end).toHaveBeenCalledWith(
		'{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}',
	);
});

test('with headers', () => {
	const error = unauthorized('foo', ['abc', 'def']);
	const res = new MockedResponse();
	sendBoom(error, res);

	expect(res.statusCode).toBe(401);
	expect(res.setHeader).toHaveBeenCalledTimes(1);
	expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'abc, def');
	expect(res.end).toHaveBeenCalledWith('{"statusCode":401,"error":"Unauthorized","message":"foo"}');
});
