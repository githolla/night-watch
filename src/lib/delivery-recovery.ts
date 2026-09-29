import { deliveryReservationId } from './delivery-state.ts';
export type RecoveryRecord = {id:string;card_id:string;person_id:string;owner:string;context:string;created_at:string;updated_at:string;status:string};
export function recoveryDetails(row: RecoveryRecord): {kind:string;stepId?:string;initialReservation?:boolean} | null {
  let delivery: {kind?:string;stepId?:string;initialReservation?:boolean}|undefined;
  try { delivery=JSON.parse(row.context || '{}').delivery; } catch { /* legacy snapshot */ }
  if(delivery?.kind==='followup' && delivery.stepId && row.id===deliveryReservationId(delivery.initialReservation ? row.card_id : `cadence:${delivery.stepId}`,row.person_id))return {kind:'followup',stepId:delivery.stepId,...(delivery.initialReservation?{initialReservation:true}:{})};
  if(row.id===deliveryReservationId(row.card_id,row.person_id))return {kind:'initial'};
  return null;
}
export function recoveryReady(createdAt:string, now=Date.now()) {
  const created=Date.parse(createdAt);
  return Number.isFinite(created) && now-created>=10*60*1000;
}
