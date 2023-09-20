import { API } from '@discordjs/core';
import { injectable } from 'inversify';
import { Kysely } from 'kysely';
import type { DB } from '../db';
import type { IUserActionValidator, UserActionValidatorContext } from './IUserActionValidator';
import { UserActionValidator } from './UserActionValidator.js';

@injectable()
export class UserActionValidatorFactory {
	public constructor(
		private readonly api: API,
		private readonly db: Kysely<DB>,
	) {}

	public build(context: UserActionValidatorContext): IUserActionValidator {
		return new UserActionValidator(this.api, this.db, context);
	}
}
