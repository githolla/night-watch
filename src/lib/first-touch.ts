import { decodeBody, sanitizeSignatureHtml } from "./clean.ts";
import { emailStyle } from "./email-style.ts";
/** First-touch policy: validate rather than silently rewrite a manager's edits. */
export function firstTouchErrors(subject:string, body:string):string[] {
 const errors:string[]=[];
 if(/(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ai)\b)/i.test(body)) errors.push('Remove links from the first email. Share supporting material after a reply.');
 if((body.match(/\?/g)||[]).length!==1) errors.push('Use exactly one question in the first email.');
 const banned=/\b(?:AI[- ]powered|leverage|synergy|solutions|game[- ]changing|revolutionary|cutting[- ]edge|unlock|supercharge|seamless|transformative|best[- ]in[- ]class)\b/i.exec(subject+' '+body);
 if(banned) errors.push(`Replace “${banned[0]}” with plain, specific language.`);
 if(/[—–]/.test(body+subject)) errors.push('Use normal punctuation, not long dashes.');
 return errors;
}
/** Preserve the saved footer's text while excluding links and remotely loaded images. */
export function firstTouchSignature(signature?:string, senderName=''):string {
 const decoded=decodeBody(decodeBody(signature??''));
 const text=decoded
  .replace(/<!--[^]*?-->/g,'')
  .replace(/<(head|title|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
  .replace(/<br\s*\/?>|<\/(?:div|p|tr|table|h[1-6]|li)>/gi,'\n')
  .replace(/<\/td>/gi,' ')
  .replace(/<[^>]*>/g,'')
  .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi,'')
  .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,'')
  .replace(/\b[a-z0-9.-]+\.(?:com|net|org|io|co|ai)(?:\/\S*)?/gi,'')
  .replace(/&(?:#x?[0-9a-f]+|[a-z]+);/gi,'');
 const first=senderName.trim().split(/\s+/)[0]?.toLowerCase();
 const seen=new Set<string>();
 return text.split('\n').map(line=>emailStyle(line).replace(/^[\p{So}\s|·•]+|[\p{So}\s|·•]+$/gu,'').trim()).filter(line=>{
  if(!/[\p{L}\p{N}]/u.test(line)||/gmail signature|email signature/i.test(line))return false;
  if(first&&line.toLowerCase().split(/\s+/)[0]===first&&/^[\p{L} .'-]+$/u.test(line))return false;
  if(seen.has(line.toLowerCase()))return false;
  seen.add(line.toLowerCase());return true;
 }).join('\n');
}

export function titleGuidance(title:string,locations?:number) {
 if(locations!==undefined&&locations>=200&&/CEO|chief executive|president|founder/i.test(title))return 'For this scale, find the COO or VP of Operations who owns the workflow before sending.';
 if(locations===undefined)return 'Company scale is unconfirmed. Confirm who owns this workflow; at roughly 200 locations, prefer COO or VP Operations to CEO.';
 return 'Confirm this person owns the workflow. A CEO can be appropriate at a smaller group; a referral question keeps the ask easy.';
}

/** Retain the uploaded signature's table, typography and colors without clickable links or remote assets. */
export function firstTouchFooterHtml(signature?:string):string {
 const raw=(signature??'').trim();
 if(!raw)return '';
 if(!/<[a-z][^>]*>/i.test(raw))return firstTouchSignature(raw).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
 return sanitizeSignatureHtml(raw)
  .replace(/<!--[^]*?-->/g,'')
  .replace(/<(head|title)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
  .replace(/<!doctype[^>]*>|<\/?(?:html|body)[^>]*>/gi,'')
  .replace(/<(?:img|source|video|audio)\b[^>]*>/gi,'')
  .replace(/<\/?a\b[^>]*>/gi,'')
  .replace(/\s(?:background|src|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
  .replace(/url\([^)]*\)|expression\([^)]*\)/gi,'none')
  .split(/(<[^>]+>)/g).map(part=>{
    if(part.startsWith('<'))return part;
    return decodeBody(decodeBody("x"+part+"x")).slice(1,-1).replace(/(?:https?:\/\/|www\.)[^\s<>]+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b[a-z0-9.-]+\.(?:com|net|org|io|co|ai)\b/gi,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }).join('')
  .replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi,row=>/[\p{L}\p{N}]/u.test(decodeBody(row.replace(/<[^>]*>/g,'')))?row:'');
}
