import { kConfig } from '@automoderator/injection';
import { container } from 'tsyringe';
import { randomBytes } from 'crypto';
import { encrypt, decrypt } from '../crypt';

jest.mock('crypto', () => {
  const original: typeof import('crypto') = jest.requireActual('crypto');
  return {
    ...original,
    randomBytes: (len: number) => Buffer.from(Array(len).fill(1))
  };
});

container.register(kConfig, {
  useValue: { encryptionKey: randomBytes(32).toString('base64') }
});

const PLAIN_DATA = 'this is very sensitive';
const SECRET_DATA = encrypt(PLAIN_DATA);

test('encrypt', () => {
  expect(SECRET_DATA).toBe('AQEBAQEBAQEBAQEBAQEBAejE/bWU7BLYic/V/zbJLfwqp2c5B/8=');
});

test('decrypt', () => {
  expect(decrypt(SECRET_DATA)).toBe(PLAIN_DATA);
});
