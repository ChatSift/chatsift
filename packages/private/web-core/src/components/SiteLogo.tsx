import Link from 'next/link';
import { SvgChatSift } from './icons/SvgChatSift';

interface SiteLogoProps {
	readonly href?: string;
	/**
	 * The wordmark beside the ChatSift mark. `unban.app` names itself rather than "ChatSift": an appellant
	 * arrives having been sent to that domain and nowhere else, and a header that renames itself to a product
	 * they have never heard of reads as the wrong site (#232 decision 3, applied to the header rather than to
	 * the consent screen). The mark stays, because the footer says whose site it is anyway.
	 */
	readonly label: string;
}

export function SiteLogo({ label, href = '/' }: SiteLogoProps) {
	return (
		<Link className="mr-6 flex flex-row items-center" href={href}>
			<SvgChatSift />
			<h1 className="m-0 ml-2 text-2xl font-medium text-primary dark:text-primary-dark">{label}</h1>
		</Link>
	);
}
