// Sourced from https://github.com/skyra-project/skyra/blob/a1d39a2fa988a73fa32ae59d22106a10eb3ce106/projects/shared/src/lib/data

// Copyright 2019 Skyra Project

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

// 		http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import type { SimpleDataTypes } from './Data.js';
import { DataType } from './Data.js';

export class Writer {
	private readonly encoder = new TextEncoder();

	private data: Buffer;

	private offset = 0;

	public constructor(size: number) {
		this.data = Buffer.alloc(size);
	}

	public dump() {
		return this.data;
	}

	public dumpTrimmed() {
		return this.data.subarray(0, this.offset);
	}

	public bool(value?: boolean | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(2);
		this.offset += this.data.writeUInt8(DataType.Bool, this.offset);
		this.offset += this.data.writeUInt8(value ? 1 : 0, this.offset);

		return this;
	}

	public i8(value?: number | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(2);
		this.offset += this.data.writeUInt8(DataType.I8, this.offset);
		this.offset += this.data.writeInt8(value, this.offset);

		return this;
	}

	public u8(value?: number | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(2);
		this.offset += this.data.writeUInt8(DataType.U8, this.offset);
		this.offset += this.data.writeUInt8(value, this.offset);

		return this;
	}

	public i16(value?: number | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(5);
		this.offset += this.data.writeUint8(DataType.I16, this.offset);
		this.offset += this.data.writeInt16LE(value, this.offset);

		return this;
	}

	public u16(value?: number | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(5);
		this.offset += this.data.writeUInt8(DataType.U16, this.offset);
		this.offset += this.data.writeUInt16LE(value, this.offset);

		return this;
	}

	public i32(value?: number | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(5);
		this.offset += this.data.writeUInt8(DataType.I32, this.offset);
		this.offset += this.data.writeInt32LE(value, this.offset);

		return this;
	}

	public u32(value?: number | null) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(5);
		this.offset += this.data.writeUInt8(DataType.U32, this.offset);
		this.offset += this.data.writeUInt32LE(value, this.offset);

		return this;
	}

	public u64(value?: bigint | number | string | null, dataType: DataType = DataType.U64) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(9);
		this.offset += this.data.writeUInt8(dataType, this.offset);
		this.offset += this.data.writeBigUInt64LE(BigInt(value), this.offset);

		return this;
	}

	public string(value?: string | null) {
		if (!value?.length) {
			return this.writeNull();
		}

		const data = this.encoder.encode(value);

		// Type + length + characters
		this.ensure(5 + data.byteLength);
		this.offset += this.data.writeUInt8(DataType.String, this.offset);
		this.offset += this.data.writeUInt32LE(data.byteLength, this.offset);
		this.data.set(data, this.offset);
		this.offset += data.byteLength;

		return this;
	}

	public date(value?: number | string | null) {
		if (value == null) {
			return this.writeNull();
		}

		const parsed = typeof value === 'string' ? Date.parse(value) : value;
		return this.u64(parsed, DataType.Date);
	}

	public array<T>(values: readonly T[] | null, mapper: (buffer: this, value: T) => void) {
		if (!values?.length) {
			return this.writeNull();
		}

		this.ensure(5);
		this.offset += this.data.writeUInt8(DataType.Array, this.offset);
		this.offset += this.data.writeUInt32LE(values.length, this.offset);
		for (const value of values) {
			mapper(this, value);
		}

		return this;
	}

	public object<T extends Record<string, unknown>>(value: T | null, mapper: (buffer: this, value: T) => void) {
		if (value == null) {
			return this.writeNull();
		}

		this.ensure(1);
		this.offset += this.data.writeUInt8(DataType.Object, this.offset);
		mapper(this, value);

		return this;
	}

	public typeUnsafeArbitraryWrite(dataType: SimpleDataTypes, value: any) {
		switch (dataType) {
			case DataType.Bool: {
				this.bool(value as boolean);
				break;
			}

			case DataType.I8: {
				this.i8(value as number);
				break;
			}

			case DataType.U8: {
				this.u8(value as number);
				break;
			}

			case DataType.I16: {
				this.i16(value as number);
				break;
			}

			case DataType.U16: {
				this.u16(value as number);
				break;
			}

			case DataType.I32: {
				this.i32(value as number);
				break;
			}

			case DataType.U32: {
				this.u32(value as number);
				break;
			}

			case DataType.U64: {
				this.u64(value as bigint | number | string);
				break;
			}

			case DataType.String: {
				this.string(value as string);
				break;
			}

			case DataType.Date: {
				this.date(value as number | string);
				break;
			}
		}
	}

	private writeNull() {
		this.ensure(1);
		this.offset += this.data.writeUInt8(DataType.Null, this.offset);

		return this;
	}

	private ensure(bytes: number) {
		const nextOffset = this.offset + bytes;
		if (nextOffset < this.data.byteLength) {
			return;
		}

		const data = Buffer.alloc(Math.max(nextOffset, this.data.byteLength * 2));
		data.set(this.data, 0);
		this.data = data;
	}
}
