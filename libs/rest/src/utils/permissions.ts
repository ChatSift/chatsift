/* istanbul ignore file */

import { BitField, BitFieldResolvable } from '@cordis/bitfield';

const PERMISSIONS = BitField.makeFlags([
  'useFileFilters',
  'manageFileFilters',
  'useUrlFilters',
  'manageUrlFilters',
  'administrator'
]);

export type PermissionsResolvable = BitFieldResolvable<keyof typeof PERMISSIONS>;

export class Permissions extends BitField<keyof typeof PERMISSIONS> {
  public constructor(bits: PermissionsResolvable) {
    super(PERMISSIONS, bits);
  }

  public override any(permission: PermissionsResolvable, checkAdmin = true) {
    return (checkAdmin && super.has(PERMISSIONS.administrator)) || super.any(permission);
  }

  public override has(permission: PermissionsResolvable, checkAdmin = true) {
    return (checkAdmin && super.has(PERMISSIONS.administrator)) || super.has(permission);
  }
}
