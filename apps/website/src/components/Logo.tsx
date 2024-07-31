import React from 'react';
import SvgChatSift from '~/components/svg/SvgChatSift';

export default function Logo() {
	return (
		<a className="flex flex-row items-center mr-6" href="/">
			<SvgChatSift />
			<h1 className="text-zinc-700 dark:text-zinc-300 font-bold text-xl m-0 ml-2" tabIndex={0}>
				ChatSift
			</h1>
		</a>
	);
}
