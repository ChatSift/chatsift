/**
 * Resync (#216 P6, see docs/roadmap/01-architecture.md §8) is split across two routes (#331) --
 * `snippets/resyncSnippets.ts` and `panels/resyncPanels.ts` -- because a guild's snippet commands and its
 * panel messages are independently repairable and live on separate dashboard pages. This is the one piece of
 * their result shape they share.
 */
export interface ResyncFailure {
	error: string;
	/**
	 * Human-readable identifier for whichever snippet/command/panel this failure is about -- there's no single
	 * shared id space across the kinds of item resync touches, so this is just enough to find it (name for a
	 * snippet/command, numeric id for a panel) rather than a structured reference.
	 */
	item: string;
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
