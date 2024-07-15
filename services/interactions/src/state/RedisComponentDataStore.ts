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
	// It's incredibly hard to add narrower types to bin-rw in its current state.
	// Instead, because as casts suck a lot here and they allow us to forget adding a prop to this recipe,
	// we use the type below, which at least guarantees that all keys are present.
	private readonly pendingModCaseRecipe: Recipe<Record<keyof ConfirmModCaseState, any>> = createRecipe({
		kind: DataType.String,
		reason: DataType.String,
		targetId: DataType.String,
		references: [DataType.U32],
		deleteMessageSeconds: DataType.U32,
		timeoutDuration: DataType.U32,
	});

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
