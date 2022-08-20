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

import { TextDecoder } from 'node:util';

export class Reader {
	private readonly decoder = new TextDecoder();

	public readonly data: Buffer;
	private offset = 0;

	public constructor(data: Buffer) {
		this.data = data;
	}

	public bool(): boolean | null {
		if (this.readNull()) {
			return null;
		}
		return this.data.readUInt8(this.offset++) === 1;
	}

	public i8(): number | null {
		if (this.readNull()) {
			return null;
		}
		return this.data.readInt8(this.offset++);
	}

	public u8(): number | null {
		if (this.readNull()) {
			return null;
		}
		return this.data.readUInt8(this.offset++);
	}

	public i16(): number | null {
		if (this.readNull()) {
			return null;
		}
		const value = this.data.readInt16LE(this.offset);
		this.offset += 2;
		return value;
	}

	public u16(): number | null {
		if (this.readNull()) {
			return null;
		}
		const value = this.data.readUInt16LE(this.offset);
		this.offset += 2;
		return value;
	}

	public i32(): number | null {
		if (this.readNull()) {
			return null;
		}
		const value = this.data.readInt32LE(this.offset);
		this.offset += 4;
		return value;
	}

	public u32(): number | null {
		if (this.readNull()) {
			return null;
		}
		const value = this.data.readUInt32LE(this.offset);
		this.offset += 4;
		return value;
	}

	public u64(): bigint | null {
		if (this.readNull()) {
			return null;
		}
		const value = this.data.readBigUInt64LE(this.offset);
		this.offset += 8;
		return value;
	}

	public string(): string | null {
		if (this.readNull()) {
			return null;
		}

		const length = this.data.readUInt32LE(this.offset);
		this.offset += 4;

		const string = this.decoder.decode(this.data.subarray(this.offset, this.offset + length));
		this.offset += length;
		return string;
	}

	public date(): number | null {
		if (this.readNull()) {
			return null;
		}
		const value = this.data.readBigUInt64LE(this.offset);
		this.offset += 8;
		return Number(value);
	}

	public array<T>(cb: (buffer: this) => T): T[] {
		if (this.readNull()) {
			return [];
		}

		const length = this.data.readUInt32LE(this.offset);
		this.offset += 4;

		const values: T[] = [];
		for (let i = 0; i < length; i++) {
			values.push(cb(this));
		}

		return values;
	}

	public object<T extends Record<string, unknown>>(cb: (buffer: this) => T): T | null {
		if (this.readNull()) {
			return null;
		}

		return cb(this);
	}

	private readNull() {
		return this.data.readUInt8(this.offset++);
	}
}
