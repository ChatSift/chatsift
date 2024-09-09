import Link from 'next/link';
import React from 'react';
import SvgChatSift from '~/components/svg/SvgChatSift';

export default function Logo() {
	return (
		<Link className="flex h-fit flex-row items-center" href="/">
			<SvgChatSift className="size-8" />
			<h1 className="font-medium text-primary">ChatSift</h1>
		</Link>
	);
}
