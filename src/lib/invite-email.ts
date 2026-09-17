const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The teammate-invite email, shared so the app and any tooling send identical copy.
 *  Link-based: the recipient sets their own password, then connects their Google account.
 *  Returns a plain-text part and a branded, email-safe HTML part. */
export function buildInviteEmail(opts: { name: string; appUrl: string; inviteUrl: string; senderName: string }) {
  const first = (opts.name || "").trim().split(/\s+/)[0] || "there";
  const app = (opts.appUrl || "").trim().replace(/\s+/g, "").replace(/\/$/, "");
  const sender = (opts.senderName || "The Nine-67 team").trim();
  const invite = opts.inviteUrl;
  const subject = "You're set up on Night Watch — Nine-67";

  const text =
    `Hi ${first},\n\n` +
    `You've been added to Night Watch, our outbound desk. Here's how to get going:\n\n` +
    `1) Set your password using your personal invite link:\n     ${invite}\n\n` +
    `2) That drops you straight into the app. You can also sign in any time at:\n     ${app}\n\n` +
    `3) Once you're in, go to Settings → Connect Google to link your work Gmail. ` +
    `Your outreach then sends from your own inbox and replies come back into Night Watch.\n\n` +
    `Any trouble at all, just reply to this email.\n\n` +
    `— ${sender}\nNine-67`;

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1712;max-width:520px;margin:0 auto">` +
      `<div style="font:700 15px Georgia,'Times New Roman',serif;letter-spacing:2px;text-transform:uppercase;color:#9a8258;margin-bottom:4px">Nine&#8209;67</div>` +
      `<div style="font:700 24px Georgia,'Times New Roman',serif;color:#1a1712;margin-bottom:18px">Welcome to Night&nbsp;Watch</div>` +
      `<p style="margin:0 0 14px">Hi ${esc(first)},</p>` +
      `<p style="margin:0 0 18px">You've been added to Night Watch, our outbound desk. It takes about a minute to get going:</p>` +
      `<p style="margin:0 0 8px"><strong>1. Set your password</strong></p>` +
      `<p style="margin:0 0 18px"><a href="${esc(invite)}" style="display:inline-block;background:#1a1712;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:15px">Set your password &rarr;</a></p>` +
      `<p style="margin:0 0 22px;font-size:13px;color:#6b6459">Button not working? Paste this link into your browser:<br><a href="${esc(invite)}" style="color:#9a8258;word-break:break-all">${esc(invite)}</a></p>` +
      `<p style="margin:0 0 8px"><strong>2. Sign in any time</strong> at <a href="${esc(app)}" style="color:#9a8258">${esc(app.replace(/^https?:\/\//, ""))}</a></p>` +
      `<p style="margin:0 0 22px"><strong>3. Connect your Gmail</strong> — inside the app, open <em>Settings &rarr; Connect Google</em>. Your outreach then sends from your own inbox and replies land back in Night Watch.</p>` +
      `<p style="margin:0 0 4px">Any trouble at all, just reply to this email.</p>` +
      `<p style="margin:22px 0 0;color:#6b6459">&mdash; ${esc(sender)}<br>Nine&#8209;67</p>` +
    `</div>`;

  return { subject, text, html };
}
