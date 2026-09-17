/** The teammate-invite email, shared so the app and any tooling send identical copy.
 *  Link-based: the recipient sets their own password, then connects their Google account. */
export function buildInviteEmail(opts: { name: string; appUrl: string; inviteUrl: string; senderName: string }) {
  const first = (opts.name || "").trim().split(/\s+/)[0] || "there";
  const app = (opts.appUrl || "").trim().replace(/\s+/g, "").replace(/\/$/, "");
  const subject = "You're set up on Night Watch — Nine-67";
  const text =
    `Hi ${first},\n\n` +
    `You've been added to Night Watch, our outbound desk. Here's how to get going:\n\n` +
    `1) Set your password using your personal invite link:\n     ${opts.inviteUrl}\n\n` +
    `2) That drops you straight into the app. You can also sign in any time at:\n     ${app}\n\n` +
    `3) Once you're in, go to Settings → Connect Google to link your work Gmail. ` +
    `Your outreach then sends from your own inbox and replies come back into Night Watch.\n\n` +
    `Any trouble at all, just reply to this email.\n\n` +
    `— ${(opts.senderName || "The Nine-67 team").trim()}\nNine-67`;
  return { subject, text };
}
