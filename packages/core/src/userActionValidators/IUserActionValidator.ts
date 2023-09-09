/**
 * Structure responsible for assisting in determining if a certain operation with a user target is allowed.
 */
export interface IUserActionValidator {
	/**
	 * Determines if the moderator is hiarchically allowed to perform an action on a target user,
	 * and if the target user is actionable (i.e. is not a moderator themselves).
	 */
	targetIsActionable(): Promise<boolean>;
}
