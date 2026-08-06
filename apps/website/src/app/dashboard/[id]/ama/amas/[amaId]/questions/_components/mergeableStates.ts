// Single source of truth shared with the API (services/api/src/routes/ama/schemas.ts, re-exported by
// services/api/src/routes/ama/questions/mergeShared.ts) via the browser-safe `@chatsift/api/ama-schemas`
// package export -- keeping one definition means the dashboard's selection UI and the API's own merge
// validation can never drift out of sync on which states are still mergeable.
export { MERGEABLE_STATES } from '@chatsift/api/ama-schemas';
