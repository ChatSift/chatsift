import { Button } from '@/components/common/Button';
import { URLS } from '@/utils/urls';

export function LoginButton() {
	return (
		<Button type="button">
			<a href={URLS.API.LOGIN}>Log in</a>
		</Button>
	);
}
