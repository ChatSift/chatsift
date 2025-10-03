import type { SerializeOptions } from 'cookie';
import { context } from '../context.js';

export const cookieWithDomain = <Cookie extends SerializeOptions>(cookie: Cookie): Cookie => ({
	...cookie,
	domain: context.env.IS_PRODUCTION ? context.env.ROOT_DOMAIN : undefined,
});
