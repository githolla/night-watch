import { createCipheriv,createDecipheriv,randomBytes,createHash } from "node:crypto";
function key(){const raw=process.env.TOKEN_ENCRYPTION_KEY;if(!raw)throw new Error("TOKEN_ENCRYPTION_KEY is missing");return createHash("sha256").update(raw).digest()}
export function encrypt(value:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(),iv),data=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString("base64url")).join(".")}
export function decrypt(value:string){const [i,t,d]=value.split(".").map(x=>Buffer.from(x,"base64url")),decipher=createDecipheriv("aes-256-gcm",key(),i);decipher.setAuthTag(t);return Buffer.concat([decipher.update(d),decipher.final()]).toString("utf8")}
