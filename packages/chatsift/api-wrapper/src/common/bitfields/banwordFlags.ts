/* istanbul ignore file */
import { BitField, BitFieldResolvable } from '@cordis/bitfield';

const BANWORD_FLAGS = BitField.makeFlags(['word', 'warn', 'mute', 'ban', 'report', 'name', 'kick']);

export type BanwordFlagsResolvable = BitFieldResolvable<keyof typeof BANWORD_FLAGS>;

export class BanwordFlags extends BitField<keyof typeof BANWORD_FLAGS> {
	public constructor(bits: BanwordFlagsResolvable) {
		super(BANWORD_FLAGS, bits);
	}

	public getPunishments(): ['report'?, 'warn'?, 'mute'?, 'kick'?, 'ban'?] {
		const punishments: ['report'?, 'warn'?, 'mute'?, 'kick'?, 'ban'?] = [];

		for (const punishment of ['report', 'warn', 'mute', 'kick', 'ban'] as const) {
			if (this.has(punishment)) {
				punishments.push(punishment);
			}
		}

		return punishments;
	}
}
