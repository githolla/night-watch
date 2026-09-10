"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { SlackPanel } from "@/components/SlackPanel";
import { TargetAccountsPanel } from "@/components/TargetAccountsPanel";

type FeatureId = "research" | "desk" | "messaging" | "simulation" | "learning" | "slack";
type Focus = "find" | "decide" | "write" | "learn";
type Role = "founder" | "growth" | "research" | "operations";

type Feature = {
  id: FeatureId;
  index: string;
  name: string;
  short: string;
  outcome: string;
};

const features: Feature[] = [
  { id: "research", index: "01", name: "Signal research", short: "Watch companies and sources", outcome: "Find reasons to reach out" },
  { id: "desk", index: "02", name: "Morning desk", short: "Review ranked people", outcome: "Make today’s decisions" },
  { id: "messaging", index: "03", name: "Messages + cadence", short: "Write and plan follow-through", outcome: "Prepare human outreach" },
  { id: "simulation", index: "04", name: "Message simulation", short: "Pressure-test A/B variants", outcome: "Improve the message" },
  { id: "learning", index: "05", name: "Learning analytics", short: "Compare outcomes and signals", outcome: "See what actually works" },
  { id: "slack", index: "06", name: "Slack command center", short: "Operate from one channel", outcome: "Manage the desk in Slack" },
];

const focusOrder: Record<Focus, FeatureId[]> = {
  find: ["research", "desk", "slack", "messaging", "simulation", "learning"],
  decide: ["desk", "slack", "research", "messaging", "simulation", "learning"],
  write: ["messaging", "simulation", "desk", "slack", "learning", "research"],
  learn: ["learning", "simulation", "desk", "research", "messaging", "slack"],
};

const defaultPins: Record<FeatureId, boolean> = { research: true, desk: true, messaging: true, simulation: true, learning: true, slack: true };
const defaultPreferences = { active: "desk" as FeatureId, focus: "decide" as Focus, role: "founder" as Role, pins: defaultPins };
const storageKey = "night-watch-workspace";
const storageEvent = "night-watch-workspace-change";

function subscribePreferences(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(storageEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(storageEvent, callback);
  };
}

function preferenceSnapshot() {
  return localStorage.getItem(storageKey) ?? "";
}

function serverPreferenceSnapshot() {
  return "";
}

function parsePreferences(raw: string) {
  try {
    const saved = JSON.parse(raw || "{}") as Partial<typeof defaultPreferences>;
    return {
      active: saved.active && features.some((feature) => feature.id === saved.active) ? saved.active : defaultPreferences.active,
      focus: saved.focus && focusOrder[saved.focus] ? saved.focus : defaultPreferences.focus,
      role: saved.role && ["founder", "growth", "research", "operations"].includes(saved.role) ? saved.role : defaultPreferences.role,
      pins: { ...defaultPins, ...saved.pins },
    };
  } catch {
    return defaultPreferences;
  }
}

function savePreferences(value: typeof defaultPreferences) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  window.dispatchEvent(new Event(storageEvent));
}

interface Props {
  targetCount: number;
  targetTotal: number;
  slackConnected: boolean;
  slackChannelId: string;
  gmailConnections: Array<{ owner: string; email: string }>;
  cardsToday: number;
  experiments: number;
  outcomes: number;
}

export function FeatureControlCenter(props: Props) {
  const stored = useSyncExternalStore(subscribePreferences, preferenceSnapshot, serverPreferenceSnapshot);
  const preferences = useMemo(() => parsePreferences(stored), [stored]);
  const { active, focus, role, pins } = preferences;

  const ordered = useMemo(() => [...features].sort((a, b) => {
    const pinDifference = Number(pins[b.id]) - Number(pins[a.id]);
    return pinDifference || focusOrder[focus].indexOf(a.id) - focusOrder[focus].indexOf(b.id);
  }), [focus, pins]);
  const selected = features.find((feature) => feature.id === active) ?? features[1];

  function togglePin(id: FeatureId) {
    savePreferences({ ...preferences, pins: { ...pins, [id]: !pins[id] } });
  }

  return <div className="feature-center">
    <section className="workspace-builder">
      <div className="workspace-builder-copy">
        <span className="eyebrow">Workspace guide</span>
        <h1>Build the desk around how you work.</h1>
        <p>Choose your role and today’s objective. Night Watch moves the most useful tools to the top, while every capability remains one click away.</p>
      </div>
      <div className="workspace-profile" aria-label="Workspace preferences">
        <label><span>Your role</span><select value={role} onChange={(event) => savePreferences({ ...preferences, role: event.target.value as Role })}><option value="founder">Founder / principal</option><option value="growth">Growth lead</option><option value="research">Research analyst</option><option value="operations">Revenue operations</option></select></label>
        <label><span>Today’s focus</span><select value={focus} onChange={(event) => savePreferences({ ...preferences, focus: event.target.value as Focus })}><option value="decide">Decide who to contact</option><option value="find">Find new signals</option><option value="write">Improve messages</option><option value="learn">Review performance</option></select></label>
        <div className="workspace-profile-summary"><span>YOUR WORKSPACE</span><strong>{Object.values(pins).filter(Boolean).length} features pinned</strong><small>Saved on this device</small></div>
      </div>
    </section>

    <section className="feature-workspace">
      <aside className="feature-directory">
        <header><span className="eyebrow">Feature directory</span><p>Click into a capability to see what it does, its live status, and the next action.</p></header>
        <div className="feature-list">{ordered.map((feature) => <div className={`feature-row ${feature.id === active ? "active" : ""}`} key={feature.id}>
          <button className="feature-open" type="button" title={feature.outcome} onClick={() => savePreferences({ ...preferences, active: feature.id })} aria-pressed={feature.id === active}>
            <span>{feature.index}</span><span><strong>{feature.name}</strong><small>{feature.short}</small></span><b>→</b>
          </button>
          <button className={`feature-pin ${pins[feature.id] ? "pinned" : ""}`} type="button" onClick={() => togglePin(feature.id)} aria-label={`${pins[feature.id] ? "Unpin" : "Pin"} ${feature.name}`}>{pins[feature.id] ? "PINNED" : "PIN"}</button>
        </div>)}</div>
      </aside>

      <div className="feature-detail" key={selected.id}>{renderFeature(selected.id, props)}</div>
    </section>
  </div>;
}

function FeatureFrame({ index, title, description, status, children }: { index: string; title: string; description: string; status: string; children: ReactNode }) {
  return <section className="feature-sheet">
    <header className="feature-sheet-head"><div><span className="eyebrow">Feature {index}</span><h2>{title}</h2><p>{description}</p></div><span className="feature-status">{status}</span></header>
    {children}
  </section>;
}

function Facts({ items }: { items: Array<[string, string, string?]> }) {
  return <div className="feature-facts">{items.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>)}</div>;
}

function Actions({ primaryHref, primary, secondaryHref, secondary }: { primaryHref: string; primary: string; secondaryHref?: string; secondary?: string }) {
  return <div className="feature-actions"><a className="btn primary" href={primaryHref}>{primary} <span>→</span></a>{secondaryHref && secondary && <a className="btn" href={secondaryHref}>{secondary}</a>}</div>;
}

function renderFeature(id: FeatureId, props: Props) {
  if (id === "research") return <FeatureFrame index="01" title="Signal research" description="Define where Night Watch looks and keep the target universe current." status={props.targetCount === props.targetTotal ? "ready" : "attention"}>
    <Facts items={[["Target universe", `${props.targetCount} active companies`, "Revenue-qualified account list"], ["Nightly scan", "06:00 UTC", "Public web research"], ["Evidence sources", "Careers · executives · news · events", "Every signal links to its origin"], ["Cost guard", "$10 per run", "Stops before over-spending"]]} />
    <div className="feature-how"><span>HOW TO USE IT</span><ol><li>Keep the companies you want watched active.</li><li>Night Watch checks each source overnight.</li><li>Open the overview to inspect every new signal.</li></ol></div>
    <Actions primaryHref="/" primary="Review live signals" />
    <TargetAccountsPanel initialCount={props.targetCount} targetTotal={props.targetTotal} />
  </FeatureFrame>;

  if (id === "desk") return <FeatureFrame index="02" title="Morning desk" description="Turn overnight evidence into a short, ranked decision queue for human review." status={`${props.cardsToday} today`}>
    <Facts items={[["Surface threshold", "60 points", "Weak signals stay out of the queue"], ["High priority", "75+ points", "The strongest reasons appear first"], ["Decision controls", "Approve · snooze · dismiss", "No outreach without judgment"], ["Primary source", "Always visible", "Open the original evidence before acting"]]} />
    <div className="feature-how"><span>RECOMMENDED FLOW</span><ol><li>Open the highest-scoring dossier.</li><li>Verify why this person and why now.</li><li>Approve only when the evidence earns outreach.</li></ol></div>
    <Actions primaryHref="/desk" primary="Open morning desk" secondaryHref="/desk?priority=high" secondary="High priority only" />
  </FeatureFrame>;

  if (id === "messaging") return <FeatureFrame index="03" title="Messages + cadence" description="Write a relevant first touch, then plan intelligent follow-through across channels." status={props.gmailConnections.length ? "gmail connected" : "manual first"}>
    <Facts items={[["Default mode", "Manual outreach", "Copy to LinkedIn or your email client"], ["Cadence", "Signal-aware follow-through", "Stops after a recorded reply"], ["Gmail", props.gmailConnections.length ? props.gmailConnections.map((item) => item.email).join(", ") : "Not connected", "Optional direct sending"], ["Daily email cap", "15 per sender", "Safety limit stays enforced"]]} />
    <div className="feature-how"><span>HOW TO USE IT</span><ol><li>Approve a dossier in the morning desk.</li><li>Edit the message using the source context.</li><li>Copy it, send manually, and record the touch.</li></ol></div>
    <Actions primaryHref="/desk" primary="Open message workspace" secondaryHref="/api/gmail/connect" secondary={props.gmailConnections.length ? "Reconnect Gmail" : "Connect Gmail (optional)"} />
  </FeatureFrame>;

  if (id === "simulation") return <FeatureFrame index="04" title="Message simulation" description="Compare A/B variants with a four-perspective review room before sending." status={`${props.experiments} experiments`}>
    <Facts items={[["Variants", "Two per experiment", "Original versus challenger"], ["Review room", "Buyer · operator · skeptic · editor", "Different failure modes, one decision"], ["Output", "Scores + recommendation", "Reasoning remains visible"], ["Learning loop", "Winner linked to outcome", "Simulation and reality stay separate"]]} />
    <div className="feature-how"><span>RUN A SIMULATION</span><ol><li>Open any dossier with a drafted message.</li><li>Select “Simulate A/B message.”</li><li>Review the scores, choose a winner, then track the actual outcome.</li></ol></div>
    <Actions primaryHref="/desk" primary="Choose a dossier" secondaryHref="/stats#experiments" secondary="View experiment results" />
  </FeatureFrame>;

  if (id === "learning") return <FeatureFrame index="05" title="Learning analytics" description="See which signals, channels, and message choices produce replies and meetings." status={`${props.outcomes} outcomes`}>
    <Facts items={[["Observed outcomes", String(props.outcomes), "Replies manually recorded or detected"], ["Message experiments", String(props.experiments), "Simulation history and chosen variants"], ["Signal analysis", "Source + trigger", "Find what creates real conversations"], ["Primary result", "Meetings", "The metric that matters most"]]} />
    <div className="feature-how"><span>WHAT TO REVIEW</span><ol><li>Compare simulated winners with observed outcomes.</li><li>Look for signal and channel patterns.</li><li>Use the evidence to improve the next message—not to automate judgment.</li></ol></div>
    <Actions primaryHref="/stats" primary="Open learning analytics" secondaryHref="/stats#experiments" secondary="Message experiments" />
  </FeatureFrame>;

  return <FeatureFrame index="06" title="Slack command center" description="Bring the morning brief and the essential decision controls into your team’s operating channel." status={props.slackConnected ? "connected" : "setup required"}>
    <Facts items={[["Morning brief", "12:00 UTC", "Highest-scoring dossiers with sources"], ["Command", "/night-watch", "Open the desk privately from Slack"], ["Human controls", "Approve · snooze · dismiss", "Writes to the same Night Watch records"], ["Outcomes", "Reply · referral · meeting", "Feeds Learning analytics"]]} />
    <SlackPanel connected={props.slackConnected} channelId={props.slackChannelId} embedded />
  </FeatureFrame>;
}
