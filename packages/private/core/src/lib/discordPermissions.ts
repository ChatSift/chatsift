import type { ValueResolvable } from '@sapphire/bitfield';
import { BitField } from '@sapphire/bitfield';
import type { APIOverwrite, APIRole, Snowflake } from 'discord-api-types/v10';
import { OverwriteType, PermissionFlagsBits } from 'discord-api-types/v10';

export const PermissionsBitField = new BitField(PermissionFlagsBits);

export type PermissionsResolvable = ValueResolvable<typeof PermissionsBitField>;

export interface ComputeChannelPermissionsOptions {
	guildId: Snowflake;
	guildOwnerId: Snowflake;
	memberId: Snowflake;
	memberRoleIds: readonly Snowflake[];
	overwrites: readonly Pick<APIOverwrite, 'allow' | 'deny' | 'id' | 'type'>[];
	roles: readonly Pick<APIRole, 'id' | 'permissions'>[];
}

export function computeChannelPermissions({
	guildId,
	guildOwnerId,
	memberId,
	memberRoleIds,
	overwrites,
	roles,
}: ComputeChannelPermissionsOptions): bigint {
	if (memberId === guildOwnerId) {
		return PermissionsBitField.mask;
	}

	const permissionsByRoleId = new Map(roles.map((role) => [role.id, BigInt(role.permissions)]));
	const memberRoles = new Set(memberRoleIds);

	let permissions = permissionsByRoleId.get(guildId) ?? 0n;
	for (const roleId of memberRoles) {
		permissions |= permissionsByRoleId.get(roleId) ?? 0n;
	}

	if (PermissionsBitField.has(permissions, PermissionFlagsBits.Administrator)) {
		return PermissionsBitField.mask;
	}

	const everyoneOverwrite = overwrites.find(
		(overwrite) => overwrite.type === OverwriteType.Role && overwrite.id === guildId,
	);
	if (everyoneOverwrite) {
		permissions &= ~BigInt(everyoneOverwrite.deny);
		permissions |= BigInt(everyoneOverwrite.allow);
	}

	let roleAllow = 0n;
	let roleDeny = 0n;
	for (const overwrite of overwrites) {
		if (overwrite.type === OverwriteType.Role && overwrite.id !== guildId && memberRoles.has(overwrite.id)) {
			roleAllow |= BigInt(overwrite.allow);
			roleDeny |= BigInt(overwrite.deny);
		}
	}

	permissions &= ~roleDeny;
	permissions |= roleAllow;

	const memberOverwrite = overwrites.find(
		(overwrite) => overwrite.type === OverwriteType.Member && overwrite.id === memberId,
	);
	if (memberOverwrite) {
		permissions &= ~BigInt(memberOverwrite.deny);
		permissions |= BigInt(memberOverwrite.allow);
	}

	return permissions;
}

export function permissionNames(permissions: bigint): string[] {
	return PermissionsBitField.toArray(permissions).map((name) => name.replaceAll(/(?<=[a-z])(?=[A-Z])/g, ' '));
}
