/**
 * Responsible for caching data in Redis.
 */
export interface ICache<ValueType> {
	delete(id: string): Promise<void>;
	get(id: string): Promise<ValueType | null>;
	getOld(id: string): Promise<ValueType | null>;
	has(id: string): Promise<boolean>;
	set(id: string, value: ValueType): Promise<void>;
}
