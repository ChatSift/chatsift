import { Boom } from '@hapi/boom';
import type { Request, Response } from 'polka';
import { afterEach, expect, test, vi } from 'vitest';
import z from 'zod';
import { validate } from '../validate.js';

const next = vi.fn();

afterEach(() => {
	vi.resetAllMocks();
});

const makeMockedRequest = (data: any) => data as Request;
const mockedResponse = {} as unknown as Response;

test('invalid schema', () => {
	const validator = validate(
		z
			.object({
				foo: z.string(),
			})
			.strict(),
		'body',
	);

	void validator(makeMockedRequest({ body: { foo: 1 } }), mockedResponse, next);
	expect(next).toHaveBeenCalledWith(expect.any(Boom));
});

test('valid schema', () => {
	const validator = validate(
		z
			.object({
				foo: z.string(),
				bar: z.number().default(5),
			})
			.strict(),
		'body',
	);

	const req = { body: { foo: 'bar' } };

	void validator(makeMockedRequest(req), mockedResponse, next);
	expect(next).toHaveBeenCalledWith();
	expect(req).toHaveProperty('body', { foo: 'bar', bar: 5 });
});
