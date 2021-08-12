import { boomify } from '@hapi/boom';
import Joi from 'joi';
import type { Request, Response } from 'polka';
import { validate } from '../validate';

const next = jest.fn();

afterEach(() => jest.clearAllMocks());

const makeMockedRequest = (data: any) => data as Request;
const mockedResponse = {} as unknown as Response;

class ValidationError extends Error {}

test('invalid schema', () => {
  const validator = validate(
    Joi.object()
      .keys({
        foo: Joi.string().required()
      })
      .required()
  );

  void validator(makeMockedRequest({ body: { foo: 1 } }), mockedResponse, next);
  expect(next).toHaveBeenCalledWith(boomify(new ValidationError('"foo" must be a string'), { statusCode: 422 }));
});

test('valid schema', () => {
  const validator = validate(
    Joi.object()
      .keys({
        foo: Joi.string().required(),
        bar: Joi.number().default(5)
      })
      .required()
  );
  const req = { body: { foo: 'bar' } };

  void validator(makeMockedRequest(req), mockedResponse, next);
  expect(next).toHaveBeenCalledWith();
  expect(req).toHaveProperty('body', { foo: 'bar', bar: 5 });
});
