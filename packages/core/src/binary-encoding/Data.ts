import type { Buffer } from 'node:buffer';

export enum DataType {
	Null,
	Bool,
	I8,
	U8,
	I16,
	U16,
	I32,
	U32,
	U64,
	String,
	Date,
	Array,
	Object,
}

export type SimpleDataTypes =
	| DataType.Bool
	| DataType.Date
	| DataType.I8
	| DataType.I16
	| DataType.I32
	| DataType.String
	| DataType.U8
	| DataType.U16
	| DataType.U32
	| DataType.U64;

export type ComplexDataTypes = DataType.Array | DataType.Object;

export interface IReader {
	array<ValueType>(mapper: (buffer: this) => ValueType): ValueType[];
	bool(): boolean | null;
	date(): number | null;
	i16(): number | null;
	i32(): number | null;
	i8(): number | null;
	object<ValueType extends Record<string, unknown>>(mapper: (buffer: this) => ValueType): ValueType | null;
	string(): string | null;
	u16(): number | null;
	u32(): number | null;
	u64(): bigint | null;
	u8(): number | null;
}

export interface IWriter {
	array<ValueType>(values: readonly ValueType[] | null, mapper: (buffer: this, value: ValueType) => void): this;
	bool(value?: boolean | null): this;
	date(value?: number | string | null): this;
	dump(): Buffer;
	dumpTrimmed(): Buffer;
	i16(value?: number | null): this;
	i32(value?: number | null): this;
	i8(value?: number | null): this;
	object<ValueType extends Record<string, unknown>>(
		value: ValueType | null,
		mapper: (buffer: this, value: ValueType) => void,
	): this;
	string(value?: string | null): this;
	u16(value?: number | null): this;
	u32(value?: number | null): this;
	u64(value?: bigint | number | string | null): this;
	u8(value?: number | null): this;
}
