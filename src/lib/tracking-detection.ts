import type { SupabaseClient } from '@supabase/supabase-js';
import { SAVED_VERSION_MODEL } from './version-attribution.ts';
export function mergeDetection(context:string,field:'firstOpenAt'|'firstGiftViewAt',at:string) {
 let parsed:Record<string,unknown>={};try{parsed=JSON.parse(context||'{}');}catch{return null;}
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return null;
 if(typeof parsed[field]==='string')return null;
 return JSON.stringify({...parsed,[field]:at});
}
/** Compare-and-swap preserves both detections when image and asset requests race. */
export async function recordDetection(db:SupabaseClient,id:string,field:'firstOpenAt'|'firstGiftViewAt') {
 for(let attempt=0;attempt<3;attempt++){
  const {data,error}=await db.from('message_experiments').select('context').eq('id',id).eq('model',SAVED_VERSION_MODEL).maybeSingle();
  if(error||!data)return;
  const next=mergeDetection(data.context??'',field,new Date().toISOString());if(!next)return;
  let update=db.from('message_experiments').update({context:next}).eq('id',id).eq('model',SAVED_VERSION_MODEL);
  update=data.context===null?update.is('context',null):update.eq('context',data.context);
  const saved=await update.select('id').maybeSingle();if(saved.error||saved.data)return;
 }
}
