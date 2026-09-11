import type { Metadata } from 'next';
import { ExperimentsConsole } from './_components/ExperimentsConsole';
import { InstanceInterestList } from './_components/InstanceInterestList';
import { NavGateCheck } from '@/components/common/NavGate';

export const metadata: Metadata = {
	title: 'Admin',
};

export default function AdminPage() {
	return (
		<NavGateCheck checkForGlobalAdmin>
			<div className="flex flex-col gap-10">
				<ExperimentsConsole />
				<InstanceInterestList />
			</div>
		</NavGateCheck>
	);
}
