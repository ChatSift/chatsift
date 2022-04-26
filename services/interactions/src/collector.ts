import type { APIMessageComponentInteraction, APIModalSubmitInteraction } from 'discord-api-types/v9';

export type CollectableInteraction = APIMessageComponentInteraction | APIModalSubmitInteraction;
export type CollectionHook<T> = (interaction: T) => unknown;
export type StopFunction = () => void;
export type AsyncCollectionHook<T> = (interaction: T, stop: StopFunction) => unknown;

export interface PendingItem<T> {
	resolve: (value: T) => void;
	reject: (reason: any) => void;
	timeout?: NodeJS.Timeout;
}

export class CollectorTimeoutError extends Error {
	public constructor(public readonly timeout: number) {
		super(`Collector timed out after ${timeout}ms`);
	}
}

export class Collector<T extends CollectableInteraction> {
	private readonly buffer: T[] = [];
	private readonly pending: PendingItem<T>[] = [];
	private readonly hooks: CollectionHook<T>[] = [];

	public constructor(private readonly id: string, private readonly manager: CollectorManager) {}

	public push(interaction: T): void {
		const currentlyPending = this.pending.shift();
		if (currentlyPending) {
			if (currentlyPending.timeout) {
				clearTimeout(currentlyPending.timeout);
			}
			return currentlyPending.resolve(interaction);
		}

		if (this.hooks.length > 0) {
			for (const hook of this.hooks) {
				hook(interaction);
			}

			return;
		}

		this.buffer.push(interaction);
	}

	public async waitForOne(timeout?: number): Promise<T> {
		if (this.buffer.length > 0) {
			return this.buffer.shift()!;
		}

		return new Promise<T>((resolve, reject) => {
			const item: PendingItem<T> = {
				resolve,
				reject,
				timeout: timeout ? setTimeout(() => reject(new CollectorTimeoutError(timeout)), timeout).unref() : undefined,
			};

			this.pending.push(item);
		});
	}

	public async waitForOneAndDestroy(timeout?: number): Promise<T> {
		const interaction = await this.waitForOne(timeout);
		this.destroy();
		return interaction;
	}

	public hook(fn: CollectionHook<T>): StopFunction {
		const idx = this.hooks.push(fn) - 1;
		if (this.buffer.length > 0) {
			while (this.buffer.length > 0) {
				fn(this.buffer.shift()!);
			}
		}

		return () => {
			this.hooks.splice(idx, 1);
		};
	}

	public hookAndDestroy(fn: CollectionHook<T>): StopFunction {
		const stop = this.hook(fn);
		return () => {
			stop();

			if (!this.hooks.length) {
				this.destroy();
			}
		};
	}

	public awaitableHook(fn: AsyncCollectionHook<T>): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const idx = this.hooks.length;
			const stop = () => {
				resolve();
				this.hooks.splice(idx, 1);
			};

			this.hooks.push((interaction) => {
				const res = fn(interaction, stop);
				if (res instanceof Promise) {
					res.catch((e) => {
						reject(e);
						stop();
					});
				}
			});

			if (this.buffer.length > 0) {
				while (this.buffer.length > 0) {
					fn(this.buffer.shift()!, stop);
				}
			}
		});
	}

	public async awaitableHookAndDestroy(fn: AsyncCollectionHook<T>): Promise<void> {
		await this.awaitableHook(fn);
		this.destroy();
	}

	public destroy() {
		this.manager.collectors.delete(this.id);
	}
}

export class CollectorManager {
	public readonly collectors: Map<string, Collector<any>> = new Map();

	public push(interaction: CollectableInteraction) {
		const [id] = interaction.data.custom_id.split('|') as [string, ...string[]];
		if (this.collectors.has(id)) {
			this.collectors.get(id)!.push(interaction);
		}
	}

	public makeCollector<T extends CollectableInteraction>(id: string): Collector<T> {
		const collector = new Collector<T>(id, this);
		this.collectors.set(id, collector);
		return collector;
	}
}
