export interface Transformer<T> {
	toBuffer: (data: T) => Buffer;
	toJSON: (data: Buffer) => T;
}
