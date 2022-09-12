import type { Case } from '@prisma/client';

export enum GuildLogType {
	ModAction = 'mod_actions',
	AutomodTrigger = 'automod_triggers',
	UserJoin = 'user_joins',
	UserLeave = 'user_leaves',
	UserUsernameUpdate = 'user_username_updates',
	UserNicknameUpdate = 'user_nickname_updates',
}

interface GuildLogBaseData {
	guildId: string;
}

export interface GuildLogModActionData extends GuildLogBaseData {
	cases: Case[];
}

export interface GuildLogMap {
	[GuildLogType.ModAction]: GuildLogModActionData;
	// [GuildLogType.AutomodTrigger]: GuildLogModActionData;
	// [GuildLogType.UserJoin]: GuildLogModActionData;
	// [GuildLogType.UserLeave]: GuildLogModActionData;
	// [GuildLogType.UserUsernameUpdate]: GuildLogModActionData;
	// [GuildLogType.UserNicknameUpdate]: GuildLogModActionData;
}
