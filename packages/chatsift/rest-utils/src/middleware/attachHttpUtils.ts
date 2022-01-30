import cookie from 'cookie';
import type { NextHandler, Request, Response } from 'polka';

declare module 'http' {
	export interface ServerResponse {
		/**
		 * Appends a header to the request - handling some nicher cases in regards to array values.
		 * It's preferred this is used over the usual `res.setHeader`
		 * @param header The name of the header to append
		 * @param value The value to set for this header
		 */
		append: (header: string, value: string | number | string[]) => void;
		/**
		 * Correctly redirects a user to a new location
		 * @param redirect The URL to redirect to
		 */
		redirect: (redirect: string) => void;
		/**
		 * Appends a cookie to the response
		 * @param name Name of the cookie
		 * @param data Data to set for this cookie
		 * @param options Options to set for this cookie - please refer to https://github.com/jshttp/cookie#options-1 for further documentation
		 */
		cookie: (name: string, data: string, options?: cookie.CookieSerializeOptions) => void;
	}
}

/**
 * Creates a request handler that attaches some utils to the response object - documentation for those can be found under {@link ServerResponse}
 */
export function attachHttpUtils() {
	return (_: Request, res: Response, next: NextHandler) => {
		res.append = (header, value) => {
			const prev = res.getHeader(header);
			if (prev) {
				value = Array.isArray(prev) ? prev.concat(value as string) : ([prev].concat(value) as string[]);
			}

			res.setHeader(header, value);
		};

		res.redirect = (redirect) => {
			res.statusCode = 302;
			res.append('Location', redirect);
			res.append('Content-Length', 0);
		};

		res.cookie = (name, data, options) => {
			const value = cookie.serialize(name, data, options);
			res.append('Set-Cookie', value);
		};

		return next();
	};
}
