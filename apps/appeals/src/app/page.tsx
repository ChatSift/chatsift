'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { Heading } from '@chatsift/web-core/components/Heading';
import { TextField } from '@chatsift/web-core/components/TextField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { loginHref, useMe } from '@/api/routes/appeals';
import { parseTarget } from '@/utils/parseTarget';

export default function LandingPage() {
	const { data: user, isPending } = useMe();
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

	return (
		<>
			<Heading
				subtitle="If you were banned from a Discord server that uses ChatSift, you can ask its moderators to take another look."
				title="Appeal a ban"
			/>

			{isPending ? null : user ? (
				<>
					<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
						<TextField
							error={error ?? undefined}
							helper="Paste any invite to the server you were banned from -- the same link you already have works. You can also paste the server ID."
							id="target"
							label="Which server?"
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
					<p className="text-sm text-secondary dark:text-secondary-dark">
						Already appealed? Your appeals and their status are on{' '}
						<a className="text-misc-accent hover:underline" href="/appeals">
							your appeals page
						</a>
						.
					</p>
				</>
			) : (
				<div className="flex flex-col items-start gap-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
					<p className="text-secondary dark:text-secondary-dark">
						Sign in with the Discord account that was banned. We use it to confirm the ban and to send you the decision.
					</p>
					<a className={buttonClass('primary')} href={loginHref('/')}>
						Sign in with Discord
					</a>
				</div>
			)}
		</>
	);
}
