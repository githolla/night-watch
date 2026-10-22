import { z } from "zod";

export async function checkVoiceTransport(value: unknown) {
  const phone = z.object({ provider: z.string(), twilioAccountSid: z.string().optional(), twilioAuthToken: z.string().optional(), credentialId: z.string().optional() }).parse(value);
  if (phone.provider !== "twilio") return { provider: phone.provider, checked: false };
  const savedSid = process.env.TWILIO_ACCOUNT_SID;
  const savedToken = process.env.TWILIO_AUTH_TOKEN;
  if (savedSid && phone.twilioAccountSid && savedSid !== phone.twilioAccountSid) return { provider: "twilio", checked: false, reason: "Saved Twilio account does not match the Vapi number account." };
  phone.twilioAccountSid = savedSid || phone.twilioAccountSid;
  phone.twilioAuthToken = savedToken || phone.twilioAuthToken;
  if (!phone.twilioAccountSid || !phone.twilioAuthToken) return { provider: "twilio", checked: false, accountSid: phone.twilioAccountSid ?? null, credentialAttached: Boolean(phone.credentialId), reason: "Vapi did not return usable Twilio account credentials for a direct check." };
  if (!/^AC[a-f0-9]{32}$/i.test(phone.twilioAccountSid)) return { provider: "twilio", checked: false, reason: "The imported Twilio Account SID is invalid." };
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${phone.twilioAccountSid}.json`, {
    headers: { authorization: `Basic ${Buffer.from(`${phone.twilioAccountSid}:${phone.twilioAuthToken}`).toString("base64")}` },
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  const result = z.object({ status: z.string().optional(), code: z.number().optional() }).safeParse(body);
  let permissions: unknown = null;
  if (response.ok) {
    const permissionResponse = await fetch("https://voice.twilio.com/v1/DialingPermissions/Countries/US", {
      headers: { authorization: `Basic ${Buffer.from(`${phone.twilioAccountSid}:${phone.twilioAuthToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    const parsed = z.object({ low_risk_numbers_enabled: z.boolean(), high_risk_special_numbers_enabled: z.boolean().optional(), high_risk_tollfraud_numbers_enabled: z.boolean().optional() }).safeParse(await permissionResponse.json().catch(() => null));
    permissions = parsed.success ? parsed.data : { httpStatus: permissionResponse.status };
  }
  return { provider: "twilio", checked: true, permissions, accountSid: phone.twilioAccountSid, credentialsAccepted: response.ok, httpStatus: response.status,
    accountStatus: response.ok && result.success ? result.data.status ?? null : null,
    errorCode: !response.ok && result.success ? result.data.code ?? null : null };
}
