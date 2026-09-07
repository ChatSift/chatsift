import type { Metadata } from 'next';
import { ExperimentsConsole } from './_components/ExperimentsConsole';
import { NavGateCheck } from '@/components/common/NavGate';

export const metadata: Metadata = {
	title: 'Admin',
};

export default function AdminPage() {
	return (
		<NavGateCheck checkForGlobalAdmin>
			<ExperimentsConsole />
		</NavGateCheck>
	);
}
