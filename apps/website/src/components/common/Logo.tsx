import Link from 'next/link';
import React from 'react';
import SvgChatSift from '~/components/svg/SvgChatSift';

export default function Logo() {
	return (
		<Link className="flex h-fit flex-row items-center gap-2 px-2" href="/">
			<SvgChatSift className="size-6" />
			<h1 className="font-medium text-primary">ChatSift</h1>
		</Link>
	);
}
