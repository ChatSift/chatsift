import { PermissionFlagsBits } from '@discordjs/core';
import type { ValueResolvable } from '@sapphire/bitfield';
import { BitField } from '@sapphire/bitfield';

export const PermissionsBitField = new BitField(PermissionFlagsBits);

export type PermissionsResolvable = ValueResolvable<typeof PermissionsBitField>;
