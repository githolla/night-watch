import { researchRecommendation } from './research-recommendation.ts';
import { savedVariants, renderSavedVariant, renderLinkedInVariant } from './outreach-variants.ts';
/** Only untouched drafts adopt a new research default. An override is saved as edited. */
export function withResearchDefault<T extends { status:string; active_variant_id?:string|null; accounts:{domain?:string|null}; people:{full_name:string}; email_subject:string|null;email_body:string|null;linkedin_message?:string|null;linkedin_subject?:string|null }>(card:T,senderName:string,greeting:string):T {
 if(card.status!=='new'||card.active_variant_id)return card;
 const recommendation=researchRecommendation(card.accounts.domain,card.people.full_name)?.recommended;
 if(!recommendation)return card;
 const email=savedVariants(card.accounts.domain,card.people.full_name).find(v=>v.id===recommendation.id);
 const li=savedVariants(card.accounts.domain,card.people.full_name,'linkedin').find(v=>v.id===recommendation.id);
 if(!email)return card;
 const draft=renderSavedVariant(email,card.people.full_name,senderName,greeting);
 // A saved LinkedIn edit must not be replaced as a side effect of opening an email.
 return {...card,email_subject:draft.subject,email_body:draft.body,...(!card.linkedin_message?.trim()&&li?{linkedin_message:renderLinkedInVariant(li,senderName).body,linkedin_subject:li.subject}:{})};
}
