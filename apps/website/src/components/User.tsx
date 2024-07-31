import Button from '~/components/Button';

function LogInButton() {
	return (
		<Button>
			<a href="/login">Log in</a>
		</Button>
	);
}

function LoggedInUser() {
	return <></>;
}

export default function Login() {
	return <LogInButton />;
}
