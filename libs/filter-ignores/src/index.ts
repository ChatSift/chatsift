import { BitField, BitFieldResolvable } from '@cordis/bitfield';

const FILTERS = BitField.makeFlags([
  'urls',
  'files',
  'invites',
  'words',
  'automod',
  'global'
]);

export type FilterIgnoresResolvable = BitFieldResolvable<keyof typeof FILTERS>;

export class FilterIgnores extends BitField<keyof typeof FILTERS> {
  public constructor(bits: FilterIgnoresResolvable) {
    super(FILTERS, bits);
  }
}
