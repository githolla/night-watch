"use client";

import { useState } from "react";

export function SlackPanel({ connected, channelId }: { connected: boolean; channelId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sendTest() {
    setState("sending");
    setMessage("");
    const response = await fetch("/api/slack/test", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      setState("error");
      setMessage(result.error ?? "Slack test failed.");
      return;
    }
    setState("success");
    setMessage("Test brief delivered. Check the configured Slack channel.");
  }

  return <section className="panel slack-panel">
    <div className="integration-head">
      <div>
        <span className="eyebrow">Primary operating surface</span>
        <h2>Slack command center</h2>
      </div>
      <span className={`integration-state ${connected ? "connected" : "pending"}`}>{connected ? "connected" : "setup required"}</span>
    </div>
    <p>Receive the morning desk in one channel, inspect source-backed dossiers, approve or snooze them, track manual email and LinkedIn outreach, and record outcomes without leaving Slack.</p>
    <div className="slack-capabilities">
      <span>Morning brief</span><span>Approve / snooze / dismiss</span><span>Manual send tracking</span><span>Outcome capture</span><span>/night-watch</span>
    </div>
    {connected ? <>
      <div className="integration-route"><span>CHANNEL</span><strong>{channelId}</strong><span>DELIVERY</span><strong>12:00 UTC</strong></div>
      <button className="btn primary" type="button" onClick={sendTest} disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send test brief"}</button>
    </> : <>
      <ol className="integration-steps">
        <li>Create the Night Watch Slack app from the included manifest.</li>
        <li>Install it to your workspace and invite it to your operating channel.</li>
        <li>Add the bot token, signing secret, and channel ID in Vercel.</li>
      </ol>
      <a className="btn" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Create Slack app ↗</a>
    </>}
    {message && <p className={state === "error" ? "integration-message error" : "integration-message"}>{message}</p>}
    <p className="integration-footnote">Full instructions: <code>docs/SLACK.md</code>. Gmail remains optional.</p>
  </section>;
}
