'use client';

import { useAtom } from 'jotai';
import Button from '~/components/common/Button';
import SvgRefresh from '~/components/svg/SvgRefresh';
import { useLoggedInUser } from '~/hooks/useLoggedInUser';
import { guildsLoadingAtom } from '~/util/atoms';

export default function RefreshGuildsButton() {
	const { refetch } = useLoggedInUser();

	const [guildsLoading] = useAtom(guildsLoadingAtom);

	return (
		<Button
			className="border-2 border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			isDisabled={guildsLoading}
			onPress={async () => refetch()}
		>
			<SvgRefresh />
			Refresh
		</Button>
	);
}
