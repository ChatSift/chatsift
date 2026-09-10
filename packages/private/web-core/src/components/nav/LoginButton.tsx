import { Button } from '../Button';

interface LoginButtonProps {
	/**
	 * Where the app's OAuth handshake starts, already carrying whatever `redirect_to` it wants. Built by the
	 * app, because the two sites redeem against two different Discord applications on two different routes.
	 */
	readonly href: string;
	readonly label?: string | undefined;
}

/**
 * Deliberately the bare `Button` -- transparent, hover-tinted -- and not `buttonClass('primary')`. In a navbar
 * the account slot is not the page's primary action, and a filled pill up there competes with whatever the page
 * itself is asking for. A page that *does* want signing in to be the primary action says so on the page (see
 * `apps/appeals`'s `SignInPrompt`).
 */
export function LoginButton({ href, label = 'Log in' }: LoginButtonProps) {
	return (
		<Button type="button">
			<a href={href}>{label}</a>
		</Button>
	);
}
