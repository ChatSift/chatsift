import type { PropsWithChildren } from 'react';
import { NavGate } from '@/components/common/NavGate';

export default function DashboardLayout({ children }: PropsWithChildren) {
	return <NavGate>{children}</NavGate>;
}
