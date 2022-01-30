import { basename, dirname } from 'path';
import type { IError, Middleware, NextHandler, Polka, Request, Response } from 'polka';

/**
 * Valid HTTP methods
 */
export enum RouteMethod {
	get = 'get',
	post = 'post',
	put = 'put',
	delete = 'delete',
	patch = 'patch',
}

/**
 * Information about a route
 */
export interface RouteInfo {
	/**
	 * Path of this route on the webserver
	 */
	path: string;
	/**
	 * Method of this route
	 */
	method: RouteMethod;
}

/**
 * Represents a route on the server
 */
export abstract class Route {
	/**
	 * Generates route information based off of the filesystem path
	 * @param path File system path to the route
	 */
	public static pathToRouteInfo(path: string): RouteInfo | null {
		const method = basename(path, '.js') as RouteMethod;

		if (!Object.values(RouteMethod).includes(method)) {
			return null;
		}

		path = path.replace(/\[([a-zA-Z]+)\]/g, ':$1').replace(/\\/g, '/');

		if (!path.startsWith('/')) {
			path = `/${path}`;
		}

		return {
			path: dirname(path),
			method,
		};
	}

	/**
	 * Middleware to use for this route - needs to be overriden by subclasses
	 */
	public readonly middleware: Middleware[] = [];

	/**
	 * Handles a request to this route
	 */
	public abstract handle(req: Request, res: Response, next?: NextHandler): unknown;

	/**
	 * Registers this route
	 * @param info Information related to this route
	 * @param server The Polka webserver to register this route onto
	 */
	public register(info: RouteInfo, server: Polka): void {
		server[info.method](
			`${info.path.startsWith('/') ? '' : '/'}${info.path}`,
			...this.middleware,
			async (req, res, next) => {
				try {
					await this.handle(req, res, next);
				} catch (e) {
					void next(e as IError);
				}
			},
		);
	}
}
