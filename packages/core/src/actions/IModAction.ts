import type { Selectable } from 'kysely';
import type { Case, RestrictCaseData, WarnCaseData } from '../db';

/**
 * Base data required to create a case.
 */
export interface BaseCaseCreateData {
	guildId: string;
	modId: string;
	reason: string | null;
	targetId: string;
}

/**
 * Data required for restrict cases.
 */
// We use a type intersection here since `OptionalCaseCreateDurationData` is a union.
export interface RestrictCaseCreateData extends BaseCaseCreateData {
	clean: boolean;
	expiresAt: Date | null;
	roleId: string;
}

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
	 *
	 * @returns A boolean indicating whether the notification was successful.
	 */
	notify(data: TIn): Promise<boolean>;
}

export interface IRestrictModAction
	extends IModAction<RestrictCaseCreateData, Selectable<Case> & Selectable<RestrictCaseData>> {}

export interface IUnrestrictModAction
	extends IModAction<Selectable<Case> & Selectable<RestrictCaseData>, Selectable<Case>> {}

export interface IWarnCaseAction extends IModAction<BaseCaseCreateData, Selectable<Case> & WarnCaseData> {}
