'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { Tooltip } from '@chatsift/web-core/components/Tooltip';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import type { ReactNode } from 'react';
import { useState } from 'react';

interface AppealLinkCopyProps {
	/**
	 * Rendered after the Copy button -- the punishment-notice editor puts its "add this to the notice" button
	 * here, and the Appeals config page passes nothing.
	 */
	readonly children?: ReactNode;
	/**
	 * `unban.app/g/<guildId>`, straight from the API (#232 P3b). Never rebuilt on the client: the origin is the
	 * API's `APPEALS_FRONTEND_URL`, and a second copy of it in the dashboard's environment is a second place to
	 * get the domain wrong.
	 */
	readonly link: string;
}

/**
 * The server's own appeal link, with a copy button: the one string a guild publishes so a banned member can
 * find their way to `unban.app` (#232 P3b).
 */
export function AppealLinkCopy({ link, children }: AppealLinkCopyProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(link);
		setCopied(true);
		setTimeout(() => setCopied(false), 2_000);
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			<code className="min-w-0 flex-1 truncate rounded-md bg-on-tertiary px-3 py-2 text-sm text-primary dark:bg-on-tertiary-dark dark:text-primary-dark">
				{link}
			</code>
			<Tooltip content="Whoever opens this signs in with Discord, answers your appeal questions, and lands in the channel your moderators review appeals in.">
				<Button className={buttonClass('secondary', 'sm')} onPress={handleCopy} type="button">
					Copy link
				</Button>
			</Tooltip>
			{children}
			{copied && <span className="text-sm text-misc-accent">Copied!</span>}
		</div>
	);
}
