import offers from '../../data/offer-versions.json' with { type: 'json' };
import rows from '../../data/research-outreach.json' with { type: 'json' };
import gifts from '../../data/outreach-gifts.json' with { type: 'json' };
export type ResearchVersion = { id: string; label: string; subject: string; message: string };
export type ResearchEvidence = {
 domain: string; contactName: string; giftId: string;
 businessIdea?: { subject: string; message: string; linkedinMessage: string };
 deliveryProof?: { subject: string; message: string; linkedinMessage: string };
 gift: { subject: string; message: string; linkedinMessage: string };
 trigger: null | { publishedDate: string; sourceUrl: string; fact: string; relevantToContact: boolean; kind: string; subject: string; message: string; linkedinMessage: string };
 peerProof: null | { verified: boolean; closePeer: boolean; sourceUrl: string; outcome: string; subject: string; message: string; linkedinMessage: string };
};
const key = (s:string) => s.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'').replace(/\s+/g,' ');
export function contactEvidence(domain?: string|null, name?: string|null): ResearchEvidence | undefined {
 return (rows as ResearchEvidence[]).find(r => domain && name && key(r.domain)===key(domain) && key(r.contactName)===key(name));
}
export const giftAsset = (id:string) => gifts.find(g=>g.id===id);
export function recommendEvidence(row:ResearchEvidence, now = new Date()) {
 const timestamp=row.trigger ? Date.parse(row.trigger.publishedDate+'T00:00:00Z') : NaN;
 const age=Math.floor((now.getTime()-timestamp)/86400000);
 const timely=!!(row.trigger?.relevantToContact && /^https:\/\//.test(row.trigger.sourceUrl) && row.trigger.fact.trim() && Number.isFinite(age) && age>=0 && age<=45);
 const peer=!!(row.peerProof?.verified && row.peerProof.closePeer && row.peerProof.outcome.trim() && /^https:\/\//.test(row.peerProof.sourceUrl));
 const asset=giftAsset(row.giftId);
 const gift=!!(asset && key(asset.domain)===key(row.domain) && key(asset.contactName)===key(row.contactName) && asset.checks.length>=3);
 const candidates=[
 {id:timely?'trigger':'business-idea',label:timely?'Trigger':'Business Idea',eligible:timely||!!row.businessIdea,score:timely?100:30,reason:timely?`${row.trigger!.kind} published ${age} days ago: ${row.trigger!.fact}`:'A practical idea based on the company’s operating work, without claiming a recent event.'},
 {id:'gift',label:'Gift',eligible:gift,score:gift?60:0,reason:gift?`A completed brief for ${row.contactName}: ${asset!.title}.`:'A completed, contact-specific brief is required.'},
 {id:peer?'peer-proof':'proof',label:peer?'Peer Proof':'Proof',eligible:peer||!!row.deliveryProof,score:peer?80:40,reason:peer?`Verified close-peer outcome: ${row.peerProof!.outcome}`:'Nine-67 delivery experience applied to this contact’s work. This is not claimed to be a same-industry case.'},
 ];
 const recommended=[...candidates].filter(c=>c.eligible).sort((a,b)=>b.score-a.score)[0] ?? null;
 return {recommended,candidates,giftId:gift?row.giftId:null};
}
export function researchRecommendation(domain?:string|null,name?:string|null) {
 const row=offers.find(r=>domain&&name&&key(r.domain)===key(domain)&&key(r.contactName)===key(name));
 if(!row)return null;
 const reasons=['A direct introduction to what Nine-67 can build with this team.','One specific application and a way to judge whether it helps.','Actual Nine-67 delivery experience connected to this contact’s work.'];
 const candidates=row.variants.map((v,i)=>({id:v.id,label:v.label,eligible:true,score:i===0?100:50,reason:reasons[i]}));
 return {recommended:candidates[0],candidates,giftId:null};
}
export function researchVersions(domain?:string|null,name?:string|null,channel:'email'|'linkedin'='email',now?:Date): ResearchVersion[] {
 void now;
 const row=offers.find(r=>domain&&name&&key(r.domain)===key(domain)&&key(r.contactName)===key(name));
 return row?.variants.map(v=>({id:v.id,label:v.label,subject:v.subject,message:channel==='linkedin'?v.linkedinMessage:v.message}))??[];
}

export function authoredResearchVersions(domain?:string|null,name?:string|null,channel:'email'|'linkedin'='email'):ResearchVersion[] {
 const row=contactEvidence(domain,name);if(!row)return [];
 const drafts=[{id:'business-idea',label:'Business Idea',draft:row.businessIdea},{id:'proof',label:'Proof',draft:row.deliveryProof},{id:'trigger',label:'Trigger',draft:row.trigger},{id:'gift',label:'Gift',draft:row.gift},{id:'peer-proof',label:'Peer Proof',draft:row.peerProof}];
 return drafts.flatMap(({id,label,draft})=>draft?[{id,label,subject:draft.subject,message:channel==='linkedin'?draft.linkedinMessage:draft.message}]:[]).concat(researchVersions(domain,name,channel));
}
