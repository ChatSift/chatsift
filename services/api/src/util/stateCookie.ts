import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

export class StateCookie {
	public static from(data: string): StateCookie {
		const bytes = Buffer.from(data, 'base64');
		const nonce = bytes.subarray(0, 16);
		const createdAt = new Date(bytes.readUInt32LE(16) * 1_000);
		const redirectURI = bytes.subarray(20).toString();

		return new this(redirectURI, nonce, createdAt);
	}

	public constructor(redirectURI: string);
	public constructor(redirectURI: string, nonce: Buffer, createdAt: Date);

	public constructor(
		public readonly redirectURI: string,
		private readonly nonce: Buffer = randomBytes(16),
		public readonly createdAt: Date = new Date(),
	) {}

	public toBytes(): Buffer {
		const time = Buffer.allocUnsafe(4);
		time.writeUInt32LE(Math.floor(this.createdAt.getTime() / 1_000));
		return Buffer.concat([this.nonce, time, Buffer.from(this.redirectURI)]);
	}

	public toCookie(): string {
		return this.toBytes().toString('base64');
	}
}
