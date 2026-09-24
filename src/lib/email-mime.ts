import { randomUUID } from 'node:crypto';

type Email = {from:string;to:string;subject:string;body:string;html?:string;cc?:string[];listUnsubscribe?:string};
const header=(value:string)=>value.replace(/[\r\n]+/g,' ').trim();
const encodedHeader=(value:string)=>/[^\x00-\x7F]/.test(value)?`=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`:value;
const b64=(value:string)=>Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
/** Build exactly the MIME passed to Gmail. Inline uploaded images become CID parts. */
export function emailMime(email:Email):string {
 const id=randomUUID(),alternative=`alternative_${id}`,related=`related_${id}`;
 const images:Array<{cid:string;type:string;data:string}>=[];
 const html=email.html?.replace(/\bsrc\s*=\s*(["'])data:(image\/(?:png|jpe?g|gif|webp));base64,([a-z0-9+/=\s]+)\1/gi,(_,quote:string,type:string,data:string)=>{
  const cid=`signature-${images.length}-${id}@night-watch`;
  images.push({cid,type,data:data.replace(/\s/g,'')});return `src=${quote}cid:${cid}${quote}`;
 });
 const headers=[`From: ${header(email.from)}`,`To: ${header(email.to)}`,`Subject: ${encodedHeader(header(email.subject))}`,'MIME-Version: 1.0'];
 if(email.cc?.length)headers.push(`Cc: ${email.cc.map(header).filter(Boolean).join(', ')}`);
 if(email.listUnsubscribe)headers.push(`List-Unsubscribe: <${header(email.listUnsubscribe)}>`,`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
 const textPart=(type:string,text:string)=>[`Content-Type: ${type}; charset=UTF-8`,'Content-Transfer-Encoding: base64','',b64(text)].join('\r\n');
 if(!html)return [...headers,textPart('text/plain',email.body)].join('\r\n');
 const parts=[`Content-Type: multipart/alternative; boundary="${alternative}"`,'',`--${alternative}`,textPart('text/plain',email.body),`--${alternative}`,textPart('text/html',html),`--${alternative}--`];
 if(!images.length)return [...headers,...parts,''].join('\r\n');
 return [...headers,`Content-Type: multipart/related; boundary="${related}"`,'',`--${related}`,...parts,...images.flatMap(img=>[`--${related}`,`Content-Type: ${img.type}`,`Content-ID: <${img.cid}>`,'Content-Disposition: inline','Content-Transfer-Encoding: base64','',img.data.match(/.{1,76}/g)?.join('\r\n')??'']),`--${related}--`,''].join('\r\n');
}
