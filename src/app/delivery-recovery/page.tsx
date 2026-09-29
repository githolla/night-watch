import { Header } from '@/components/Header';
import { DeliveryRecovery } from '@/components/DeliveryRecovery';
import { requireUser } from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page(){await requireUser();return <><Header/><main><DeliveryRecovery/></main></>;}
