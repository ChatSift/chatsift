import React from 'react';
import SvgChatSift from '~/components/svg/SvgChatSift';

export default function Logo() {
	return (
		<a className="flex flex-row items-center mr-6" href="/">
			<SvgChatSift />
			<h1 className="text-primary dark:text-primary-dark font-medium text-2xl m-0 ml-2" tabIndex={0}>
				ChatSift
			</h1>
		</a>
	);
}
