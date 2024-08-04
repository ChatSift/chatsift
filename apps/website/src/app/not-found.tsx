import Link from 'next/link';
import Button from '~/components/common/Button';
import Heading from '~/components/common/Heading';

export default function NotFound() {
	return (
		<div className="flex flex-col items-center justify-center gap-4">
			<Heading title="The page you're looking for could not be found" />
			<Button className="flex justify-center gap-2 rounded-md bg-misc-accent px-4 py-3 text-lg font-[550] text-primary-dark md:inline-flex">
				<Link href="/">Go back</Link>
			</Button>
		</div>
	);
}
