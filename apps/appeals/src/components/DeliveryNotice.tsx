/**
 * What `unban.app` owes somebody whose decision cannot be DMed to them (#232 P6).
 *
 * Shown from `dm_reachable === false` only -- a known refusal, never a guess. Everybody else is `null` (never
 * attempted), which is the state a first-time appellant is in and which this deliberately says nothing about:
 * a warning shown to everybody is one nobody reads.
 *
 * It suggests nothing they cannot act on. Discord decides whether a message from an application it has no
 * shared server with gets through, and neither half of that is something this site can walk somebody through
 * reliably -- so it tells them the one thing that is always true and always works: the page itself is the
 * record, and it is here whenever they come back.
 */
export function DeliveryNotice() {
	return (
		<p className="rounded-lg border border-misc-warning/40 bg-misc-warning/10 p-3 text-sm text-misc-warning dark:border-misc-warning-dark/40 dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark">
			Discord would not let us message you last time we tried, so a decision may never reach your DMs. Check back on
			this page instead -- whatever is decided shows up here.
		</p>
	);
}
