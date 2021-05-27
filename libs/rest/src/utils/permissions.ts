import { BitField, BitFieldResolvable } from '@cordis/bitfield';

const PERMISSIONS = BitField.makeFlags([
  'useFileFilters'
]);

export type PermissionsResolvable = BitFieldResolvable<keyof typeof PERMISSIONS>;

export class Permissions extends BitField<keyof typeof PERMISSIONS> {
  public constructor(bits: PermissionsResolvable) {
    super(PERMISSIONS, bits);
  }
}
