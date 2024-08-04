import type { ValueResolvable } from '@sapphire/bitfield';
import { BitField } from '@sapphire/bitfield';
import { PermissionFlagsBits } from 'discord-api-types/v10';

export const PermissionsBitField = new BitField(PermissionFlagsBits);

export type PermissionsResolvable = ValueResolvable<typeof PermissionsBitField>;
