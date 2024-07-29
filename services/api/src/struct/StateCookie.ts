import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

export class StateCookie {
	public static from(data: string): StateCookie {
		const bytes = Buffer.from(data, 'base64');
		const nonce = bytes.subarray(0, 16);
		const createdAt = new Date(bytes.readUInt32LE(16));
		const redirectUri = bytes.subarray(20).toString();

		return new this(redirectUri, nonce, createdAt);
	}

	public constructor(redirectUri: string);
	public constructor(redirectUri: string, nonce: Buffer, createdAt: Date);

	public constructor(
		public readonly redirectUri: string,
		private readonly nonce: Buffer = randomBytes(16),
		private readonly createdAt: Date = new Date(),
	) {}

	public toBytes(): Buffer {
		const time = Buffer.allocUnsafe(4);
		time.writeUInt32LE(Math.floor(this.createdAt.getTime() / 1_000));
		return Buffer.concat([this.nonce, time, Buffer.from(this.redirectUri)]);
	}

	public toCookie(): string {
		return this.toBytes().toString('base64');
	}
}
