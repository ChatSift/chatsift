import Link from 'next/link';
import React from 'react';
import SvgChatSift from '~/components/svg/SvgChatSift';

export default function Logo() {
	return (
		<Link className="mr-6 flex flex-row items-center" href="/">
			<SvgChatSift />
			<h1 className="m-0 ml-2 text-2xl font-medium text-primary dark:text-primary-dark" tabIndex={0}>
				ChatSift
			</h1>
		</Link>
	);
}
