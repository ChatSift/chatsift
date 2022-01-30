import { Boom } from '@hapi/boom';
import * as zod from 'zod';
import type { Request, Response } from 'polka';
import { validate } from '../validate';

const next = jest.fn();

afterEach(() => jest.clearAllMocks());

const makeMockedRequest = (data: any) => data as Request;
const mockedResponse = {} as unknown as Response;

test('invalid schema', () => {
	const validator = validate(
		zod.object({
			foo: zod.string(),
		}),
	);

	void validator(makeMockedRequest({ body: { foo: 1 } }), mockedResponse, next);
	expect(next).toHaveBeenCalledWith(expect.any(Boom));
});

test('valid schema', () => {
	const validator = validate(
		zod.object({
			foo: zod.string(),
			bar: zod.number().default(5),
		}),
	);

	const req = { body: { foo: 'bar' } };

	void validator(makeMockedRequest(req), mockedResponse, next);
	expect(next).toHaveBeenCalledWith();
	expect(req).toHaveProperty('body', { foo: 'bar', bar: 5 });
});
