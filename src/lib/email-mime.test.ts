import test from 'node:test';
import assert from 'node:assert/strict';
import {emailMime} from './email-mime.ts';
import {outreachDelivery} from './outreach-ending.ts';
import {firstTouchFooterHtml} from './first-touch.ts';
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=';
const htmlPart=(mime:string)=>Buffer.from(mime.match(/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)![1].trim(),'base64').toString();
test('both senders retain their own uploaded signature through the actual Gmail MIME builder',()=>{
 for(const name of ['Josh Lee','Suuchi Ramesh']){
  const signature=`<table style="color:#765432"><tr><td><img width="80" src="data:image/png;base64,${image}"></td><td>${name}<br><a href="https://nine-67.com">Nine-67</a></td></tr></table>`;
  const profile={fromName:name,signature};
  const delivery=outreachDelivery('Hi Douglas,\n\nWould a conversation help?\n\nThanks,\nOld sender',profile);
  assert.ok(delivery.html.includes(firstTouchFooterHtml(signature)));
  assert.ok(delivery.text.includes(name));assert.doesNotMatch(delivery.text,/Old sender|Thanks,/);
  for(const subject of ['A prospect subject','[Night Watch test] A prospect subject']){
   const mime=emailMime({from:'sender@example.com',to:'recipient@example.com',subject,body:delivery.text,html:delivery.html});
   const html=htmlPart(mime);
   assert.match(mime,/multipart\/related/);assert.match(mime,/Content-Type: image\/png/);
   assert.match(html,/src="cid:signature-0-/);assert.match(html,/color:#765432/);assert.match(html,/href="https:\/\/nine-67.com"/);
   assert.ok(html.includes(name));assert.doesNotMatch(html,/data:image|Thanks,|Old sender/);
   const cid=html.match(/src="cid:([^"]+)"/)![1];assert.ok(mime.includes(`Content-ID: <${cid}>`));
   assert.ok(mime.replace(/\r\n/g,'').includes(image));
  }
 }
});
test('hosted signature image URLs are preserved without fetching them',()=>{
 const html='<img src="https://example.com/logo.png"><a href="mailto:a@example.com">Email</a>';
 const mime=emailMime({from:'a@example.com',to:'b@example.com',subject:'Hello',body:'Hello',html});
 assert.equal(htmlPart(mime),html);assert.doesNotMatch(mime,/multipart\/related/);
});
test('MIME encodes unicode content and prevents header injection',()=>{
 const mime=emailMime({from:'a@example.com',to:'b@example.com',subject:'Café\r\nBcc: victim@example.com',body:'Hello café'});
 assert.doesNotMatch(mime,/\r\nBcc:/);assert.match(mime,/Subject: =\?UTF-8\?B\?/);
 assert.ok(mime.includes(Buffer.from('Hello café').toString('base64')));
});
