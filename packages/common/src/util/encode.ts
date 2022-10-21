import { Buffer } from 'node:buffer';
import { encode as msgpackEncode, decode as msgpackDecode, ExtensionCodec } from '@msgpack/msgpack';

const codec = new ExtensionCodec();
codec.register({
	type: 0,
	encode: (input: unknown) => {
		if (typeof input === 'bigint') {
			return msgpackEncode(input.toString());
		}

		return null;
	},
	decode: (data: Uint8Array) => BigInt(msgpackDecode(data) as string),
});

export function encode(data: unknown): Buffer {
	const encoded = msgpackEncode(data, { extensionCodec: codec });
	return Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
}

export function decode(data: Buffer): unknown {
	return msgpackDecode(data, { extensionCodec: codec });
}
