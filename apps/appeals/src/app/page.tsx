'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { TextField } from '@chatsift/web-core/components/TextField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { SvgDiscord } from '@chatsift/web-core/components/icons/SvgDiscord';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { loginHref, useMe, useMyAppeals } from '@/api/routes/appeals';
import { InviteHandoff } from '@/components/InviteHandoff';
import { KnownBansList } from '@/components/KnownBansList';
import { parseTarget } from '@/utils/parseTarget';

/**
 * What actually happens, in the order it happens. Three steps because there are three, and naming them is what
 * turns "sign in with Discord" from a demand into a step somebody can see the end of -- an appellant arriving
 * here has no reason to trust the page and every reason to want to know what it wants from them first.
 */
const STEPS = [
	{
		title: 'Sign in',
		body: 'With the Discord account that was banned. That is how the server knows the appeal is really from you.',
	},
	{
		title: 'Point us at the server',
		body: 'Paste any invite to it. If you have a discord.gg link, swapping it for unban.app gets you here too.',
	},
	{
		title: 'Make your case',
		body: 'Answer the questions the server asks. Its moderators read your answers and decide.',
	},
] as const;

export default function LandingPage() {
	const { data: user, isPending } = useMe();
	// The same query `/appeals` uses, so navigating between the two costs nothing and both agree on what they
	// show. Not started until there is a session -- see `useMyAppeals`.
	const { data: mine } = useMyAppeals(Boolean(user));
	const router = useRouter();
	const [input, setInput] = useState('');
	const [error, setError] = useState<string | null>(null);

	function go(): void {
		const target = parseTarget(input);
		if (!target) {
			setError('That does not look like a server invite or a server ID.');
			return;
		}

		setError(null);
		router.push(target.kind === 'guild' ? `/g/${target.value}` : `/${target.value}`);
	}

	// Rendered ahead of every branch, and inside `Suspense` because `useSearchParams` requires one on a
	// statically-prerendered route -- which `/` is. It has to run whatever the session state is: it fires on
	// arrival from the OAuth callback, when `useMe` may well still be pending.
	const inviteHandoff = (
		<Suspense fallback={null}>
			<InviteHandoff />
		</Suspense>
	);

	if (isPending) {
		return (
			<>
				{inviteHandoff}
				<Skeleton className="h-64 w-full" />
			</>
		);
	}

	// Signed in, so the hero has done its job and the page becomes the one thing left to do.
	if (user) {
		return (
			<>
				{inviteHandoff}
				<Heading subtitle="Paste an invite to the server you were banned from." title="Which server?" />

				<KnownBansList guilds={mine?.knownBans ?? []} />

				<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
					<TextField
						error={error ?? undefined}
						helper="Any invite works, including one from your own scrollback. You can paste a server ID instead."
						id="target"
						label="Server invite"
						onChange={(value) => {
							setInput(value);
							setError(null);
						}}
						placeholder="discord.gg/example"
						trailing={
							<Button className={buttonClass('primary', 'field')} isDisabled={!input.trim()} onPress={() => go()}>
								Continue
							</Button>
						}
						value={input}
					/>
				</div>

				<p className="text-secondary dark:text-secondary-dark">
					Already appealed?{' '}
					<Link className="text-misc-accent hover:underline" href="/appeals">
						Check where it stands
					</Link>
					.
				</p>
			</>
		);
	}

	return (
		<>
			{inviteHandoff}
			<section className="flex flex-col items-center gap-6 py-8 text-center">
				<h1 className="max-w-2xl text-5xl font-medium leading-tight text-primary dark:text-primary-dark">
					Appeal a Discord ban
				</h1>
				{/*
					No promise that a decision always comes back. Denials can be silent by design (#232 decision 6),
					and the appellant's view of one is indistinguishable from a pending appeal -- so the honest claim
					is that they can always check, not that they will always be told.
				*/}
				<p className="max-w-xl text-xl text-secondary dark:text-secondary-dark">
					Answer a few questions and the moderators review your case. Check where it stands whenever you want.
				</p>

				<a className={`${buttonClass('primary')} flex items-center gap-2 text-lg`} href={loginHref('/')}>
					<SvgDiscord className="fill-accent" />
					Sign in with Discord
				</a>
			</section>

			<section className="grid gap-4 sm:grid-cols-3">
				{STEPS.map((step, index) => (
					<div
						className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-5 dark:border-on-secondary-dark dark:bg-card-dark"
						key={step.title}
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-full bg-misc-accent/10 text-sm font-medium text-misc-accent">
							{index + 1}
						</span>
						<p className="text-lg font-medium text-primary dark:text-primary-dark">{step.title}</p>
						<p className="text-sm text-secondary dark:text-secondary-dark">{step.body}</p>
					</div>
				))}
			</section>
		</>
	);
}
