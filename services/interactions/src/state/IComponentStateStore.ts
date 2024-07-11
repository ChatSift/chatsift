import type { ModCaseKind } from '@automoderator/core';
import { injectable } from 'inversify';

export interface ConfirmModCaseState {
	kind: ModCaseKind;
	reason: string;
	targetId: string;
}

@injectable()
/**
 * Responsible for mapping nanoids to state for cross-process/cross-instance state around message component interactions
 */
export abstract class IComponentStateStore {
	public constructor() {
		if (this.constructor === IComponentStateStore) {
			throw new Error('This class cannot be instantiated.');
		}
	}

	public abstract getPendingModCase(id: string): Promise<ConfirmModCaseState | null>;
	public abstract setPendingModCase(id: string, state: ConfirmModCaseState): Promise<void>;
}
