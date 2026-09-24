import { outreachFooterHtml, signatureText } from "./outreach-ending.ts";
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
/** Compatibility helpers: cold-email policy applies to the pitch, not an uploaded signature. */
export function firstTouchSignature(signature?:string, senderName=''):string {
 return signatureText({fromName:senderName,signature});
}

export function titleGuidance(title:string,locations?:number) {
 if(locations!==undefined&&locations>=200&&/CEO|chief executive|president|founder/i.test(title))return 'For this scale, find the COO or VP of Operations who owns the workflow before sending.';
 if(locations===undefined)return 'Company scale is unconfirmed. Confirm who owns this workflow; at roughly 200 locations, prefer COO or VP Operations to CEO.';
 return 'Confirm this person owns the workflow. A CEO can be appropriate at a smaller group; a referral question keeps the ask easy.';
}

/** Keep the user's saved signature, including its images, links and inline styling. */
export function firstTouchFooterHtml(signature?:string):string {
 return outreachFooterHtml({fromName:"",signature});
}
