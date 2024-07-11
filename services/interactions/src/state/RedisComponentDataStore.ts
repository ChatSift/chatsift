import { INJECTION_TOKENS } from '@automoderator/core';
import { createRecipe, DataType, type Recipe } from 'bin-rw';
import { inject, injectable } from 'inversify';
import type { Redis } from 'ioredis';
import { IComponentStateStore, type ConfirmModCaseState } from './IComponentStateStore.js';

@injectable()
/**
 * Responsible for mapping nanoids to state for cross-process/cross-instance state around message component interactions
 */
export class RedisComponentStateStore extends IComponentStateStore {
	// Need a cast for precise typing on `kind`
	private readonly pendingModCaseRecipe = createRecipe({
		kind: DataType.String,
		reason: DataType.String,
		targetId: DataType.String,
	}) as Recipe<ConfirmModCaseState>;

	public constructor(@inject(INJECTION_TOKENS.redis) private readonly redis: Redis) {
		super();
	}

	public override async getPendingModCase(id: string): Promise<ConfirmModCaseState | null> {
		const data = await this.redis.getBuffer(`component-state:mod-case:${id}`);

		if (!data) {
			return null;
		}

		return this.pendingModCaseRecipe.decode(data);
	}

	public override async setPendingModCase(id: string, state: ConfirmModCaseState): Promise<void> {
		await this.redis.set(`component-state:mod-case:${id}`, this.pendingModCaseRecipe.encode(state), 'EX', 180);
	}
}
