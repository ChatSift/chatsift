import { atom } from 'jotai';
import { store } from './store';

export interface ErrorBannerMessage {
	readonly id: number;
	readonly message: string;
}

export const errorBannerMessagesAtom = atom<ErrorBannerMessage[]>([]);

let nextId = 0;

/**
 * Queues a dismissible global error banner (`ErrorBanner`, mounted in `Providers`). Called from outside React
 * (`queryClient.ts`'s `QueryCache.onError`), hence writing through the shared store rather than a hook.
 */
export function pushErrorBanner(message: string): void {
	const id = nextId++;
	store.set(errorBannerMessagesAtom, (prev) => [...prev, { id, message }]);
}

export function dismissErrorBanner(id: number): void {
	store.set(errorBannerMessagesAtom, (prev) => prev.filter((banner) => banner.id !== id));
}
