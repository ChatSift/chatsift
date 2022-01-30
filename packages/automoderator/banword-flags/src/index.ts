import { BitField, BitFieldResolvable } from '@cordis/bitfield';

const BANWORD_FLAGS = BitField.makeFlags(['word', 'warn', 'mute', 'ban', 'report', 'name']);

export type BanwordFlagsResolvable = BitFieldResolvable<keyof typeof BANWORD_FLAGS>;

export class BanwordFlags extends BitField<keyof typeof BANWORD_FLAGS> {
	public constructor(bits: BanwordFlagsResolvable) {
		super(BANWORD_FLAGS, bits);
	}
}
