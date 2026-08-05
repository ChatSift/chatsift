import Link from 'next/link';
import { SvgLinkExternal } from '@/components/icons/SvgLinkExternal';
import { cn } from '@/utils/util';

interface LinkButtonProps {
	readonly children: React.ReactNode;
	readonly className?: string;
	readonly external?: boolean;
	readonly href: string;
	readonly variant?: 'ghost' | 'primary';
}

/**
 * A plain anchor styled as a call-to-action -- unlike `common/Button.tsx` this carries no client-side state or
 * `onPress` handling, so marketing pages that use it stay fully static and work with JavaScript disabled.
 */
export function LinkButton({ href, children, external = false, variant = 'primary', className }: LinkButtonProps) {
	const classes = cn(
		'inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-lg font-medium whitespace-nowrap',
		variant === 'primary' && 'bg-misc-accent text-white hover:opacity-90',
		variant === 'ghost' &&
			'border border-on-secondary text-primary hover:bg-on-tertiary dark:border-on-secondary-dark dark:text-primary-dark dark:hover:bg-on-tertiary-dark',
		className,
	);

	if (external) {
		// Matches `Footer.tsx`'s convention for the same kind of link: a plain anchor, no `target="_blank"` --
		// these are same-origin paths (`/support`, `/invites/ama`, ...) that 301 out via `next.config.mjs`, not
		// literal external URLs, so they should replace the current tab like any other navigation.
		return (
			<a className={classes} href={href}>
				<SvgLinkExternal />
				{children}
			</a>
		);
	}

	return (
		<Link className={classes} href={href}>
			{children}
		</Link>
	);
}
