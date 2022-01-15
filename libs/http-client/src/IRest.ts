export interface IRest {
	make: <T, D = never>(path: string, method: string, data?: D) => Promise<T>;
	get: <T>(path: string) => Promise<T>;
	post: <T, D>(path: string, data: D) => Promise<T>;
	patch: <T, D>(path: string, data: D) => Promise<T>;
	put: <T, D = never>(path: string, data?: D) => Promise<T>;
	delete: <T, D = never>(path: string, data?: D) => Promise<T>;
}
