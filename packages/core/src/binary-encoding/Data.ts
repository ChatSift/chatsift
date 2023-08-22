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

export interface DataReader {
	array<T>(mapper: (buffer: this) => T): T[];
	bool(): boolean | null;
	date(): number | null;
	i16(): number | null;
	i32(): number | null;
	i8(): number | null;
	object<T extends Record<string, unknown>>(mapper: (buffer: this) => T): T | null;
	string(): string | null;
	u16(): number | null;
	u32(): number | null;
	u64(): bigint | null;
	u8(): number | null;
}

export interface DataWriter {
	array<T>(values: readonly T[] | null, mapper: (buffer: this, value: T) => void): this;
	bool(): this;
	date(): this;
	i16(): this;
	i32(): this;
	i8(): this;
	object<T extends Record<string, unknown>>(value: T | null, mapper: (buffer: this, value: T) => void): this;
	string(): this;
	u16(): this;
	u32(): this;
	u64(): this;
	u8(): this;
}
