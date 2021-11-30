import { Boom } from '@hapi/boom';
import { Http2ServerResponse } from 'http2';
import type { Request, Response } from 'polka';
import { jsonParser } from '../jsonParser';

jest.mock('http2');

const makeMockedRequest = (requestInfo: any, data?: any): Request => ({
  setEncoding: jest.fn(),
  *[Symbol.asyncIterator]() {
    yield data;
  },
  ...requestInfo
});

const MockedResponse = Http2ServerResponse as unknown as jest.Mock<Response>;
const mockedNext = jest.fn();

afterEach(() => jest.clearAllMocks());

test('missing content type', async () => {
  const parser = jsonParser(false);

  await parser(makeMockedRequest({ headers: {} }), new MockedResponse(), mockedNext);
  expect(mockedNext).toHaveBeenCalled();
  expect(mockedNext.mock.calls[0][0]).toBeInstanceOf(Boom);
  expect(mockedNext.mock.calls[0][0].output.statusCode).toBe(400);
});

test('invalid data', async () => {
  const parser = jsonParser();

  await parser(makeMockedRequest({ headers: { 'content-type': 'application/json' } }, 'a'), new MockedResponse(), mockedNext);
  expect(mockedNext).toHaveBeenCalled();
  expect(mockedNext.mock.calls[0][0]).toBeInstanceOf(Boom);
  expect(mockedNext.mock.calls[0][0].output.statusCode).toBe(422);
});

test('empty data', async () => {
  const parser = jsonParser();

  await parser(makeMockedRequest({ headers: { 'content-type': 'application/json' } }, ''), new MockedResponse(), mockedNext);
  expect(mockedNext).toHaveBeenCalled();
  expect(mockedNext.mock.calls[0][0]).not.toBeInstanceOf(Boom);
});

test('valid data', async () => {
  const parser = jsonParser();

  const data = { foo: 'bar' };
  const req = makeMockedRequest({ headers: { 'content-type': 'application/json' } }, JSON.stringify(data));

  await parser(req, new MockedResponse(), mockedNext);
  expect(mockedNext).toHaveBeenCalledWith();
  expect(req.body).toStrictEqual(data);
});

test('valid data with raw body', async () => {
  const parser = jsonParser(true);

  const data = { foo: 'bar' };
  const req = makeMockedRequest({ headers: { 'content-type': 'application/json' } }, JSON.stringify(data));

  await parser(req, new MockedResponse(), mockedNext);
  expect(mockedNext).toHaveBeenCalledWith();
  expect(req.rawBody).toStrictEqual(JSON.stringify(data));
  expect(req.body).toStrictEqual(data);
});
