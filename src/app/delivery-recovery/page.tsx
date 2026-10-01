import { ReplyProcessingHealth } from "@/components/ReplyProcessingHealth";
import { DeliveryRecovery } from '@/components/DeliveryRecovery';
import { requireUser } from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireUser();return <><main><DeliveryRecovery/><ReplyProcessingHealth owner={user.owner}/></main></>;}
