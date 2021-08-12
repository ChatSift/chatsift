import { Config, kConfig } from '@automoderator/injection';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { container } from 'tsyringe';

export const encrypt = (data: string) => {
  const { encryptionKey } = container.resolve<Config>(kConfig);

  const key = Buffer.from(encryptionKey, 'base64');
  const iv = randomBytes(16);

  const cipher = createCipheriv('aes-256-ctr', key, iv);
  return Buffer
    .concat([iv, cipher.update(data, 'utf8'), cipher.final()])
    .toString('base64');
};

export const decrypt = (data: string) => {
  const { encryptionKey } = container.resolve<Config>(kConfig);

  const buffer = Buffer.from(data, 'base64');

  const key = Buffer.from(encryptionKey, 'base64');
  const iv = buffer.slice(0, 16);

  const decipher = createDecipheriv('aes-256-ctr', key, iv);

  return Buffer
    .concat([decipher.update(buffer.slice(16, buffer.length)), decipher.final()])
    .toString('utf8');
};
