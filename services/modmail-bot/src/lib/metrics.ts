import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Dedicated registry rather than prom-client's process-wide default, mirroring `automoderator-bot`'s
 * `lib/metrics.ts` and `services/api`'s `core/metrics.ts` (#277) -- the scrape output stays exactly this
 * taxonomy, with no `collectDefaultMetrics()` riding along implicitly.
 *
 * **Collection is unconditional; only exposure is gated** (see `@chatsift/bot-core`'s `metricsServer.ts`).
 * Every counter here is incremented in dev too: a mislabelled or never-incremented metric that only runs in
 * production is a bug you find in production, and the cost of being wrong is an in-memory add.
 *
 * **Cardinality discipline, non-negotiable:** never label by `guild_id`, `user_id`, `channel_id`,
 * `message_id`, or message content. Every label below is drawn from a closed set known at compile time. This is
 * the one mistake that turns a metrics endpoint into an outage. Per-guild questions are the dashboard's job.
 *
 * Custom instances (#216) run this same code and emit these same names; Prometheus tells them apart with a
 * `modmail_instance` target label, so `sum(...)` is the fleet and `sum by (modmail_instance) (...)` is the
 * breakdown. That separation lives in the scrape config, never in a label here.
 */
export const register = new Registry();

/**
 * `origin` mirrors `threads.origin` exactly (`panel` for the button/category flow, `dm` for a custom instance's
 * DM front door), so this counter and the column answer the same question the same way.
 */
export const ticketsOpened = new Counter({
	name: 'modmail_tickets_opened_total',
	help: 'Tickets opened, by how the user reached us',
	labelNames: ['origin'] as const,
	registers: [register],
});

/**
 * `source` is what decided the close: a moderator's `/close`, the scheduled-close sweep, or
 * `preventThreadArchive` giving up on a thread Discord archived out from under it. That last one is worth
 * separating because it is the only path that leaves `threads.closed_by_id` NULL, so "closes by staffer" and
 * "closes" are legitimately different totals.
 *
 * `result="already_closed"` is `closeThread` returning `false` -- its `WHERE closed_at IS NULL` guard matching
 * nothing, i.e. a manual `/close` racing the sweep for the same ticket. Expected and harmless in ones and twos;
 * climbing means something is closing tickets twice.
 */
export const ticketsClosed = new Counter({
	name: 'modmail_tickets_closed_total',
	help: 'Ticket closes attempted, by what decided them and whether the row was still open',
	labelNames: ['source', 'result'] as const,
	registers: [register],
});

/**
 * The setup funnel. A `pending_tickets` row exists from the moment a private thread is created until the user's
 * first message finishes the ticket -- so `started` should be closely tracked by `completed`, and `abandoned`
 * (the sweep reclaiming a thread nobody ever wrote in) is the drop-off.
 *
 * `abandoned` climbing while `completed` flattens is the failure worth watching: it means users are opening
 * tickets and then not being able to send the first message, which nothing else in the system reports.
 */
export const pendingTickets = new Counter({
	name: 'modmail_pending_tickets_total',
	help: 'Ticket setup funnel transitions',
	labelNames: ['outcome'] as const,
	registers: [register],
});

/**
 * The relay in both directions. `kind` implies the direction (`user_message` is the only user→mod one), which
 * is why there's no separate `direction` label to keep in sync -- and it makes "is the user→mod half working"
 * one series rather than a filter.
 *
 * `result="undeliverable"` is `UndeliverableUserError` -- the user closed their DMs or left the guild, so
 * nothing was sent and the staffer was told so. That is a normal outcome, not an error; `failed` is the
 * abnormal one. Splitting them is what keeps a guild whose members block DMs from looking like an outage.
 */
export const relayMessages = new Counter({
	name: 'modmail_relay_messages_total',
	help: 'Messages relayed, by what kind and what came of it',
	labelNames: ['kind', 'result'] as const,
	registers: [register],
});

/**
 * Snippet invocations. The four non-`ok` values are the resolver's own early returns, so this is the one place
 * that says how often snippets are used *wrongly* -- outside a ticket, or carrying an emoji from another guild.
 * `snippets.times_used` only ever counts the successes.
 */
export const snippetUses = new Counter({
	name: 'modmail_snippet_uses_total',
	help: 'Snippet invocations, by outcome',
	labelNames: ['result'] as const,
	registers: [register],
});

/**
 * The four background loops. `result="failed"` is a run that threw -- each loop catches and reschedules, so a
 * failure is invisible today beyond a log line.
 *
 * A flat-zero `ok` for any sweep means that loop has stopped, which for `scheduled_close` and `thread_nuke`
 * shows up to users as "the ticket I scheduled to close is still open" long before anyone looks at the bot.
 */
export const sweepRuns = new Counter({
	name: 'modmail_sweep_runs_total',
	help: 'Background sweep runs, by sweep and result',
	labelNames: ['sweep', 'result'] as const,
	registers: [register],
});

/**
 * Open tickets the anti-archive sweep skipped because the bot is no longer in their guild (#370). Not a
 * counter: this is a level, not a rate -- the same rows are skipped on every run, so what's worth alerting on
 * is the standing number, which only falls when someone re-adds the bot or the tickets are closed out.
 *
 * Before the guild-list filter existed these rows were the sweep's single largest cost: two guaranteed-403
 * requests each, every run, forever. This is what makes that visible instead of only showing up as log noise.
 */
export const strandedOpenTickets = new Gauge({
	name: 'modmail_stranded_open_tickets',
	help: 'Open tickets whose guild the bot is no longer in, skipped by the anti-archive sweep',
	registers: [register],
});

/**
 * How late a scheduled action ran: its due time to actually running. Only the two sweeps with a due time in the
 * database (`scheduled_thread_closes.close_at`, `scheduled_thread_nukes.nuke_at`) can report this; the pending
 * -ticket and anti-archive sweeps have no such moment and deliberately don't.
 *
 * Buckets run out to an hour rather than prom-client's default (top of 10s) because the failure worth seeing is
 * a loop that has stopped, not one that is a second slow -- with the defaults a wedged sweep and a healthy one
 * both read as `+Inf`. Same reasoning, and the same buckets, as `automoderator_scheduler_lag_seconds`.
 */
export const sweepLag = new Histogram({
	name: 'modmail_sweep_lag_seconds',
	help: 'Delay between a scheduled action being due and it running',
	labelNames: ['sweep'] as const,
	buckets: [1, 5, 15, 30, 60, 300, 900, 3_600],
	registers: [register],
});

/**
 * prom-client emits no series at all for a label combination until it is first incremented, so a counter that
 * has legitimately never fired reads as **"No data"** on a dashboard rather than `0` -- and `sum(increase(...))`
 * over it returns an empty vector no `> 0` guard can rescue. That makes "this should be zero" unassertable,
 * which is exactly the claim these metrics exist to support.
 *
 * Zero-initialising the closed label sets fixes it at the source. Only combinations that can actually occur are
 * listed: a series that can never be non-zero is noise, not a baseline.
 */
function zeroInitialise(): void {
	for (const origin of ['panel', 'dm']) {
		ticketsOpened.inc({ origin }, 0);
	}

	for (const source of ['command', 'scheduled', 'auto_archive']) {
		for (const result of ['closed', 'already_closed']) {
			ticketsClosed.inc({ source, result }, 0);
		}
	}

	for (const outcome of ['started', 'completed', 'abandoned']) {
		pendingTickets.inc({ outcome }, 0);
	}

	for (const kind of ['user_message', 'reply', 'snippet', 'greeting', 'farewell', 'internal_note']) {
		for (const result of ['ok', 'failed']) {
			relayMessages.inc({ kind, result }, 0);
		}
	}

	// Only the user-facing kinds can be undeliverable -- a mod-thread write has no DM to bounce off.
	for (const kind of ['reply', 'snippet', 'greeting', 'farewell']) {
		relayMessages.inc({ kind, result: 'undeliverable' }, 0);
	}

	for (const result of ['ok', 'no_thread', 'foreign_emoji', 'undeliverable', 'failed']) {
		snippetUses.inc({ result }, 0);
	}

	// Unlabelled, so there is no combination to enumerate -- but it still needs a value before the first
	// sweep run for the same "No data" reason every counter above is zero-initialised for.
	strandedOpenTickets.set(0);

	for (const sweep of ['pending_ticket', 'scheduled_close', 'thread_nuke', 'prevent_archive']) {
		for (const result of ['ok', 'failed']) {
			sweepRuns.inc({ sweep, result }, 0);
		}
	}
}

zeroInitialise();
