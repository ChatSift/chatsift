# cache

This is where we deal with caching. A couple of things to note:
- we use our own encoding format for cache to make encoding/decoding and space usage as efficient as possible.
Refer to the [`binary-encoding` directory](../binary-encoding)
for more information.
- `Cache` is deliberately not decorated with `@injectable()`, because we have a rather dynamic dependency
of a `CacheEntity`, responsible for specific encoding/decoding ops, defining the cache key and TTL of the
data and so on. As such, we use a factory singleton to create `Cache` instances.
