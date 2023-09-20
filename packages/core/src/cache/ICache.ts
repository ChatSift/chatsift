/**
 * Responsible for caching data in Redis.
 */
export interface ICache<T> {
	delete(id: string): Promise<void>;
	get(id: string): Promise<T | null>;
	getOld(id: string): Promise<T | null>;
	has(id: string): Promise<boolean>;
	set(id: string, value: T): Promise<void>;
}
