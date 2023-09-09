import type { Buffer } from 'node:buffer';
import { injectable } from 'inversify';
import type { IReader, IWriter } from './Data';
import { Reader } from './Reader.js';
import { Writer } from './Writer.js';

@injectable()
/**
 * @remarks
 * Obviously, those are not singletons.
 */
export class RWFactory {
	public buildReader(data: Buffer): IReader {
		return new Reader(data);
	}

	public buildWriter(size: number): IWriter {
		return new Writer(size);
	}
}
