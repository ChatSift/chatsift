import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { nanoid } from 'nanoid';
import type { IError, Middleware, NextHandler, Polka, Request, Response } from 'polka';
import type { ZodType } from 'zod';
import { context } from '../context.js';
import { jsonParser } from '../middleware/jsonParser.js';
import { validate } from '../middleware/validate.js';

/**
 * Valid HTTP methods
 */
export enum RouteMethod {
	delete = 'delete',
	get = 'get',
	patch = 'patch',
	post = 'post',
	put = 'put',
}

/**
 * Information about a route
 */
export interface RouteInfo {
	/**
	 * Method of this route
	 */
	method: RouteMethod;
	/**
	 * Path of this route on the webserver
	 */
	path: string;
}

export type TRequest<TBody> = Omit<Request, 'body'> & { body: TBody; trackingId: string };

/**
 * Represents a route on the server
 */
export abstract class Route<TResult, TBody> {
	public readonly __internalOnlyHereForTypeInferrenceDoNotUse__!: { body: TBody; result: TResult };

	/**
	 * Base route information
	 */
	public abstract info: RouteInfo;

	/**
	 * Middleware to use for this route - needs to be overriden by subclasses
	 */
	public readonly middleware: Middleware<TRequest<unknown>>[] = [];

	/**
	 * Schema to use for body validation. Implicitly appends a jsonParser to the middleware
	 */
	public readonly bodyValidationSchema: ZodType<TBody> | null = null;

	/**
	 * Handles a request to this route
	 */
	public abstract handle(req: TRequest<TBody>, res: Response, next: NextHandler): unknown;

	/**
	 * Registers this route
	 *
	 * @param server - The Polka webserver to register this route onto
	 */
	public register(server: Polka<TRequest<unknown>>): void {
		const middleware: Middleware<TRequest<unknown>>[] = [
			async (req, res, next) => {
				req.trackingId = nanoid(10);

				const timeout = setTimeout(() => {
					context.logger.warn(
						{ trackingId: req.trackingId, method: req.method, path: req.path },
						'request is probably hanging',
					);
				}, 30_000);

				const now = performance.now();
				res.on('close', () => {
					const durationMs = performance.now() - now;
					context.logger.info(
						{
							trackingId: req.trackingId,
							method: req.method,
							path: req.path,
							status: res.statusCode,
							duration: durationMs,
						},
						'request complete',
					);
					clearTimeout(timeout);
				});

				context.logger.info({ trackingId: req.trackingId, method: req.method, path: req.path }, 'incoming request');
				return next();
			},
		];

		if (this.bodyValidationSchema) {
			middleware.push(jsonParser(), validate(this.bodyValidationSchema, 'body'));
		}

		middleware.push(...this.middleware);

		server[this.info.method](this.info.path, ...middleware, async (req, res, next) => {
			try {
				context.logger.info(
					{ trackingId: req.trackingId, method: req.method, path: req.path },
					'passing to route handler from middleware',
				);
				await this.handle(req as TRequest<TBody>, res, next);
				context.logger.info(
					{ trackingId: req.trackingId, method: req.method, path: req.path },
					'route handler complete',
				);
			} catch (error) {
				return next(error as IError);
			}
		});
	}
}

export type ParseHTTPParameters<
	Path extends string,
	Params extends string[] = [],
> = Path extends `${string}/:${infer Param}/${infer End}`
	? ParseHTTPParameters<End, [...Params, Param]>
	: Path extends `${infer Start}/:${infer Param}`
		? ParseHTTPParameters<Start, [...Params, Param]>
		: Params;

export type InferRouteMethod<TRoute extends Route<any, any>> = TRoute['info']['method'];
export type InferRouteResult<TRoute> = TRoute extends Route<infer TResult, any> ? TResult : never;
export type InferRouteBody<TRoute extends Route<any, any>> =
	TRoute['bodyValidationSchema'] extends ZodType<infer T> ? T : never;
