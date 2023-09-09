/**
 * This file implements a `msgpack` extension codec that allows us to send `bigint` values over the wire.
 *
 * We make use of `msgpack` encoding for broker messages.
 */

import { Buffer } from 'node:buffer';
import { ExtensionCodec, encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';

const extensionCodec = new ExtensionCodec();
extensionCodec.register({
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
	const encoded = msgpackEncode(data, { extensionCodec });
	return Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
}

export function decode(data: Buffer): unknown {
	return msgpackDecode(data, { extensionCodec });
}
