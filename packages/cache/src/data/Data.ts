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
