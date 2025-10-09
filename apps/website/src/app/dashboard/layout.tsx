import type { PropsWithChildren } from 'react';
import { NavGateProvider } from '@/components/common/NavGate';

export default function DashboardLayout({ children }: PropsWithChildren) {
	return <NavGateProvider>{children}</NavGateProvider>;
}
