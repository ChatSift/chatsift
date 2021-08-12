import type { Permissions, Snowflake } from 'discord-api-types/v9';

export class RolesPermsCache {
  private readonly _cache = new Map<Snowflake, Permissions>();

  public has(id: Snowflake) {
    return this._cache.has(id);
  }

  public get(id: Snowflake) {
    return this._cache.get(id);
  }

  public add(...entries: [id: Snowflake, perms: Permissions][]) {
    setTimeout(() => {
      for (const [id] of entries) {
        this._cache.delete(id);
      }
    }, 15e3).unref();

    for (const [id, perms] of entries) {
      this._cache.set(id, perms);
    }
  }
}
