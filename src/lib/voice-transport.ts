import { z } from "zod";

export async function checkVoiceTransport(value: unknown) {
  const phone = z.object({ provider: z.string(), twilioAccountSid: z.string().optional(), twilioAuthToken: z.string().optional(), credentialId: z.string().optional() }).parse(value);
  if (phone.provider !== "twilio") return { provider: phone.provider, checked: false };
  if (!phone.twilioAccountSid || !phone.twilioAuthToken) return { provider: "twilio", checked: false, credentialAttached: Boolean(phone.credentialId), reason: "Vapi did not return usable Twilio account credentials for a direct check." };
  if (!/^AC[a-f0-9]{32}$/i.test(phone.twilioAccountSid)) return { provider: "twilio", checked: false, reason: "The imported Twilio Account SID is invalid." };
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${phone.twilioAccountSid}.json`, {
    headers: { authorization: `Basic ${Buffer.from(`${phone.twilioAccountSid}:${phone.twilioAuthToken}`).toString("base64")}` },
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  const result = z.object({ status: z.string().optional(), code: z.number().optional() }).safeParse(body);
  return { provider: "twilio", checked: true, credentialsAccepted: response.ok, httpStatus: response.status,
    accountStatus: response.ok && result.success ? result.data.status ?? null : null,
    errorCode: !response.ok && result.success ? result.data.code ?? null : null };
}
