import 'reflect-metadata';
import { TokenValidationStatus, generateToken, validateToken } from '../token';
import { randomBytes } from 'crypto';
import { container } from 'tsyringe';
import { kSql } from '@automoderator/injection';
import { compare } from 'bcrypt';

jest.mock('crypto');
jest.mock('bcrypt');

const sqlMock = jest.fn();
container.register(kSql, { useValue: sqlMock });

const bytes = Buffer.from('Nw8JLJM+fOIhESzPBHSMzdheBtcAeaELEKtg142yaqg=', 'base64');

const randomBytesMock = randomBytes as unknown as jest.Mock<Buffer, [number]>;
randomBytesMock.mockReturnValue(bytes);

const compareMock = compare as unknown as jest.Mock<Promise<boolean>, [string, string]>;
compareMock.mockImplementation((a, b) => Promise.resolve(a === b));

let token: string;

beforeAll(async () => {
  token = await generateToken(1);
  sqlMock.mockReturnValue([{ sig: token.split('.')[1] }]);
});

test('token generation', () => {
  expect(token).toBe(`${Buffer.from('1').toString('base64')}.${bytes.toString('base64')}`);
});

describe('token validation', () => {
  test('malformed token', async () => {
    expect(await validateToken('a.b.c')).toBe(TokenValidationStatus.malformedToken);
  });

  test('malformed app id', async () => {
    // Non-int parsable user id
    expect(await validateToken(`${Buffer.from('awooga', 'utf8').toString('base64')}.bcdefg`)).toBe(TokenValidationStatus.malformedAppId);
  });

  test('no sig match', async () => {
    // Adding characters to the signature (end of the token) to prevent a match
    expect(await validateToken(`${token}abcdefg`)).toBe(TokenValidationStatus.noMatch);
  });

  test('valid token', async () => {
    expect(await validateToken(token)).toBe(TokenValidationStatus.success);
  });
});
