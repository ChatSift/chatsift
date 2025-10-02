import { badData } from '@hapi/boom';
import type { NextHandler, Request, Response } from 'polka';
import type { ZodType } from 'zod';

/**
 * Request properties that can be validated
 */
export type ValidateMiddlewareProp = 'body' | 'headers' | 'params' | 'query';

/**
 * Creates a request handler that validates a given request property - also potentially mutates the property, applying defaults and sane type conversions
 *
 * @param schema - A shapeshift schema to validate the property against - please refer to the zod documentation for more information
 * @param prop - The property to validate
 */
export function validate(schema: ZodType<any>, prop: ValidateMiddlewareProp) {
	return async (req: Request, _: Response, next: NextHandler) => {
		const result = schema.safeParse(req[prop]);

		if (!result.success) {
			return next(badData(result.error?.message, result.error));
		}

		req[prop] = result.data as unknown;
		return next();
	};
}
