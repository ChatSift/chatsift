import Link from 'next/link';
import { Button } from '@/components/common/Button';
import { URLS } from '@/utils/urls';

export function LoginButton() {
	return (
		<Button type="button">
			<Link href={URLS.API.LOGIN}>Log in</Link>
		</Button>
	);
}
