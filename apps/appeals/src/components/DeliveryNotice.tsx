/**
 * What `unban.app` owes somebody whose decision cannot be DMed to them (#232 P6).
 *
 * Shown from `dm_reachable === false` only -- a known refusal, never a guess. Everybody else is `null` (never
 * attempted), which is the state a first-time appellant is in and which this deliberately says nothing about:
 * a warning shown to everybody is one nobody reads.
 *
 * It suggests nothing they cannot act on. Discord decides whether a message from an application it has no
 * shared server with gets through, and neither half of that is something this site can walk somebody through
 * reliably -- so it does the one useful thing left: point them away from waiting on a DM.
 *
 * **It must not promise that a decision will appear here**, which an earlier draft did ("whatever is decided
 * shows up here"). A silent denial reads as "under review" on this page forever (decision 6), so that sentence
 * was false for exactly the appellants it would have left waiting longest -- and a warning that tells somebody
 * to keep checking a page that will never change is worse than no warning at all.
 */
export function DeliveryNotice() {
	return (
		<p className="rounded-lg border border-misc-warning/40 bg-misc-warning/10 p-3 text-sm text-misc-warning dark:border-misc-warning-dark/40 dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark">
			Discord would not let us message you last time we tried, so a decision may never reach your DMs. Check back on
			this page rather than waiting on one.
		</p>
	);
}
