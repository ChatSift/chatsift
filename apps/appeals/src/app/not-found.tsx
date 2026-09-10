import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import Link from 'next/link';

export default function NotFound() {
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
			<p className="text-6xl font-medium text-on-secondary dark:text-on-secondary-dark">404</p>
			<p className="text-2xl font-medium text-primary dark:text-primary-dark">Page not found</p>
			<p className="max-w-md text-lg text-secondary dark:text-secondary-dark">
				If you were given a link to appeal a ban, open it again -- it may have been cut short.
			</p>
			{/* A plain `Link`, so the way out of a 404 never depends on the client bundle having hydrated. */}
			<Link className={`mt-3 ${buttonClass('secondary')}`} href="/">
				Start over
			</Link>
		</div>
	);
}
