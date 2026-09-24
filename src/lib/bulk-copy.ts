/** Replace just the first prose paragraph; retain the recipient greeting and the rest. */
export function replaceOpening(body:string,opening:string):string {
 const parts=body.trim().split(/\n\s*\n/);
 const greeting=/^(?:hi|hello|hey|dear|greetings|good morning|good afternoon|good evening)\b[^\n.!?]*[,!]?$|^[\p{L}'-]+,$/iu;
 if(greeting.test(parts[0]?.trim()??'')){
  return [parts[0],opening.trim(),...parts.slice(2)].join('\n\n');
 }
 // Some older drafts have only one newline after the greeting.
 const lines=(parts[0]??'').split('\n');
 if(lines.length>1&&greeting.test(lines[0].trim()))return [lines[0],opening.trim(),...parts.slice(1)].join('\n\n');
 return [opening.trim(),...parts.slice(1)].join('\n\n');
}
