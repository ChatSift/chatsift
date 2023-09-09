import type { Selectable } from 'kysely';
import type { Case, RoleCaseData, WarnCaseData } from '../db';

/**
 * Represents additional data related to the duration of a case.
 *
 * This is optional, either both properties or neither must be passed in, and is meant to be "mixed-in" to other
 * case data interfaces that support timed actions.
 */
export type OptionalCaseCreateDurationData =
	| {
			duration: null;
			expiresAt: null;
	  }
	| {
			duration: number;
			expiresAt: Date;
	  };

/**
 * Base data required to create a case.
 */
export interface BaseCaseCreateData {
	guildId: string;
	modId: string;
	reason?: string;
	targetId: string;
}

/**
 * Data required for role cases.
 */
// We use a type intersection here since `OptionalCaseCreateDurationData` is a union.
export type RoleCaseCreateData = BaseCaseCreateData &
	OptionalCaseCreateDurationData & {
		clean: boolean;
		roleId: string;
	};

/**
 * Structure responsible for preparation, execution, and notification of a mod action.
 *
 * Note that call order is important but not the same for all types of actions. There's cases where `execute` can cause
 * the member to no longer in the guild, so `notify` must be called first.
 */
export interface IModAction<TIn, TOut> {
	/**
	 * Executes the action.
	 */
	execute(data: TIn): Promise<TOut>;
	/**
	 * Notifies the target of the action.
	 */
	notify(data: TIn): Promise<void>;
}

export interface IRoleModAction extends IModAction<RoleCaseCreateData, Selectable<Case> & Selectable<RoleCaseData>> {}

export interface IUnroleModAction extends IModAction<Selectable<Case> & Selectable<RoleCaseData>, Selectable<Case>> {}

export interface IWarnCaseAction extends IModAction<BaseCaseCreateData, Selectable<Case> & WarnCaseData> {}
