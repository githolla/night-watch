import { AcceptInviteForm } from "./AcceptInviteForm";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="login"><div className="login-card">
    <div className="eyebrow">Nine-67 · Night Watch</div>
    <h1>Set your password</h1>
    <p>You&rsquo;ve been invited to Night Watch. Choose a password to finish setting up your account, then connect your Google account to start sending.</p>
    <AcceptInviteForm token={token} />
  </div></main>;
}
