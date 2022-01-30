import { badData } from '@hapi/boom';
import type { ZodTypeAny } from 'zod';
import type { NextHandler, Request, Response } from 'polka';

/**
 * Request properties that can be validated
 */
export type ValidateMiddlewareProp = 'body' | 'query' | 'params' | 'headers' | 'body';

/**
 * Creates a request handler that validates a given request property - also potentially mutates the property, applying defaults and sane type conversions
 * @param schema A zod schema to validate the property against - please refer to the zod documentation for more information
 * @param prop The property to validate
 */
export function validate(schema: ZodTypeAny, prop: ValidateMiddlewareProp = 'body') {
	return (req: Request, _: Response, next: NextHandler) => {
		const result = schema.safeParse(req[prop]);

		if (!result.success) {
			return next(badData(result.error.message));
		}

		req[prop] = result.data as unknown;
		return next();
	};
}
