import { encrypt, decrypt } from './crypto.ts';
import { giftAsset } from './research-recommendation.ts';
const purpose='night-watch-gift:';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function giftToken(assetId:string,versionId:string) {
 if(!giftAsset(assetId)||!uuid.test(versionId))throw new Error('Invalid gift tracking reference');
 return encrypt(purpose+assetId+':'+versionId);
}
export function giftReference(token:string) {
 if(!token||token.length>700)return null;
 try{const plain=decrypt(token);if(!plain.startsWith(purpose))return null;const [assetId,versionId]=plain.slice(purpose.length).split(':');return giftAsset(assetId)&&uuid.test(versionId)?{assetId,versionId}:null;}catch{return null;}
}
/** Only our known gift URL for this exact recipient is decorated. */
export function trackedGiftCopy(text:string,assetId:string,versionId:string) {
 const asset=giftAsset(assetId);if(!asset)return text;
 const url=`https://night-watch-snowy.vercel.app/gift/${assetId}`;
 const link = new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\?t=[A-Za-z0-9_.-]+)?", "g");
 return text.replace(link,`${url}?t=${giftToken(assetId,versionId)}`);
}
export function firstGiftViewAt(context:unknown):string|null {
 if(typeof context!=='string')return null;
 try{const value=JSON.parse(context).firstGiftViewAt;return typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;}catch{return null;}
}
