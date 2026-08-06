// FLAGGED means a mod specifically pulled this question aside for separate handling, and ASKED means
// it's already publicly posted (possibly with an answer) -- merging either away as "just a duplicate"
// would silently undo that decision or delete public content. DENIED is already a resolved outcome.
// Only questions still in the active pending/approved pipeline can be merged away. Mirrors the API's own
// `MERGEABLE_STATES` (services/api/src/routes/ama/questions/mergeShared.ts).
export const MERGEABLE_STATES = new Set(['PENDING_MOD_REVIEW', 'PENDING_GUEST_REVIEW', 'APPROVED']);
