import { getContext } from '@chatsift/backend-core';
import type { SerializeOptions } from 'cookie';

export const cookieWithDomain = <Cookie extends SerializeOptions>(cookie: Cookie): Cookie => ({
	...cookie,
	domain: getContext().env.IS_PRODUCTION ? getContext().env.ROOT_DOMAIN : undefined,
});
