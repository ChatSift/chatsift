import Button from '~/components/Button';

function LogInButton() {
	return (
		<Button className="flex items-center mr-6 md:ml-auto gap-6 text-secondary dark:text-secondary-dark text-lg">
			<a>Log in</a>
		</Button>
	);
}

function LoggedInUser() {
	return <></>;
}

export default function Login() {
	return <LogInButton />;
}
