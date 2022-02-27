// /api/v2/users
import type { APIUser } from 'discord-api-types/v9';
import type { UserGuild } from '../../common';

// GET /@me
export type GetUsersMeResult = APIUser & { guilds: UserGuild[] };
