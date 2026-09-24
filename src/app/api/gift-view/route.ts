import { admin } from '@/lib/supabase/admin';
import { giftReference } from '@/lib/gift-tracking';
import { giftAsset } from '@/lib/research-recommendation';
import { versionMeta } from '@/lib/version-attribution';
import { recordDetection } from '@/lib/tracking-detection';
export async function POST(request:Request) {
 try{
  const payload=await request.json();const ref=typeof payload.token==='string'?giftReference(payload.token):null;
  if(ref){const db=admin();const {data}=await db.from('message_variants').select('experiment_id,dimensions').eq('id',ref.versionId).maybeSingle();const meta=versionMeta(data?.dimensions);
   if(data&&meta&&['gmail','test','followup'].includes(meta.source)&&meta.domain===giftAsset(ref.assetId)?.domain)await recordDetection(db,data.experiment_id,'firstGiftViewAt');
  }
 }catch{/* Reading a gift must not depend on analytics. */}
 return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
}
