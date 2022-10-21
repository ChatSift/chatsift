import type { Buffer } from 'node:buffer';

export type ITransformer<T> = {
	toBuffer(data: T): Buffer;
	toJSON(data: Buffer): T;
};
