import { BitField, BitFieldResolvable } from '@cordis/bitfield';

const initialPermissions = BitField.makeFlags([
	'createInstantInvite',
	'kickMembers',
	'banMembers',
	'administrator',
	'manageChannels',
	'manageGuild',
	'addReactions',
	'viewAuditLog',
	'prioritySpeaker',
	'stream',
	'viewChannel',
	'sendMessages',
	'sendTTSMessages',
	'manageMessages',
	'embedLinks',
	'attachFiles',
	'readMessageHistory',
	'mentionEveryone',
	'useExternalEmojis',
	'viewGuildInsights',
	'connect',
	'speak',
	'muteMembers',
	'deafenMembers',
	'moveMembers',
	'useVAD',
	'changeNickname',
	'manageNicknames',
	'manageRoles',
	'manageWebhooks',
	'manageEmojis',
]);

const PERMISSIONS: typeof initialPermissions & { all: bigint } = {
	...initialPermissions,
	all: Object.values(initialPermissions).reduce((acc, p) => acc | p, 0n),
};

export type DiscordPermissionsResolvable = BitFieldResolvable<keyof typeof PERMISSIONS>;

export class DiscordPermissions extends BitField<keyof typeof PERMISSIONS> {
	public constructor(bits: DiscordPermissionsResolvable) {
		super(PERMISSIONS, bits);
	}

	public override any(permission: DiscordPermissionsResolvable, checkAdmin = true) {
		return (checkAdmin && super.has(PERMISSIONS.administrator)) || super.any(permission);
	}

	public override has(permission: DiscordPermissionsResolvable, checkAdmin = true) {
		return (checkAdmin && super.has(PERMISSIONS.administrator)) || super.has(permission);
	}
}
