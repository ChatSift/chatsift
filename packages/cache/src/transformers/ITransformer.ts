export interface ITransformer<T> {
	toBuffer: (data: T) => Buffer;
	toJSON: (data: Buffer) => T;
}
