/** Approved evidence: public case study plus the owner's account of the 20-app engagement.
 * Keep deployment, built/ready and measured outcomes distinct. No invented ROI or client identity.
 */
export const OUTREACH_EVIDENCE = `Owner-supplied positioning: Nine-67 is an AI-first company with forward-deployed engineers who understand business and operations, work directly with leaders and users, and keep up with AI. Explain the practical help: taking on the build, involving leaders at key decisions, iterating with users, training for adoption and deploying working products. No specific start date, staffing commitment or measured outcome is supplied. Nine-67 recently helped one client deploy 20 applications (owner supplied; no timeframe or measured ROI supplied). Mention this selectively, never as a mandatory opener. Public case study: a PE-backed professional-services firm's account-risk/revenue view reached production in one month. A client-reporting tool is built and ready, with report-grounded answers and editable branded PowerPoint/Excel exports. An RFP workspace brings requirements, approved knowledge, drafting and review together. Do not call every case study deployed or attribute savings, adoption rates, or the 20-app count to the public case-study client. Delivery process: meet leaders to choose priorities, respect their time with focused decisions, build a working first version, iterate with users, train teams for adoption, deploy working products. Choose ONE relevant proof point or process detail, not a catalogue. Do not claim the prospect has a problem you have not verified. Do not position software as a guaranteed replacement for hiring.`;

const PROCESS = [
  "At Nine-67, we turn a leader's priority into a working first version, refine it with users, and train the team as we deploy.",
  "Our approach at Nine-67 is to build a small working version first, test it with the people doing the work, then refine and deploy it with training.",
  "Nine-67 keeps leadership involved in the decisions that matter, while we handle the build, user feedback, training and deployment.",
  "We start with the team that owns the work, build something they can try, and iterate before deployment. Training is part of the delivery.",
];
const DEPLOYED = [
  "We recently helped one client deploy 20 applications. We worked with leaders on priorities, then built, iterated and trained the teams as we deployed.",
  "Nine-67 recently helped a client deploy 20 applications, taking the work from leadership priorities through working versions, user feedback and team training.",
  "Our recent work with one client reached 20 deployed applications. Each started with a business priority, with iteration and training built into delivery.",
];
const CASES = {
  finance: [
    "Our recent client deployment included a forecast builder and a client-profitability application. We developed the tools with leaders and trained the teams as we deployed.",
    "We have deployed financial-planning and client-profitability tools with a client. The approach starts with a working version that the finance team can react to.",
    "A forecast builder was part of our recent client deployment. We work through the decisions with leaders, then iterate with the people who will use the product.",
  ],
  delivery: [
    "Our recent client deployment included a resource-allocation application and a collaboration workspace, with iteration and training as part of delivery.",
    "We have deployed a resource-allocation tool with a client. We start with the people making those decisions, build a first version, then refine it with them.",
    "A collaboration workspace was among the applications we recently deployed for a client. We build with the team and include training as we put it into use.",
  ],
  proposals: [
    "We built a proposal workspace for a professional-services firm that brings RFP requirements, approved prior work, drafting and review into one place.",
    "Our proposal workspace checks a draft against requirements and flags unsupported claims before submission, with the team controlling the final response.",
    "For a professional-services firm, we built a workspace that finds relevant approved proposals and case studies, then supports drafting and review.",
  ],
  reporting: [
    "We built a client-reporting tool with editable, branded PowerPoint and Excel exports. It is ready for the account team to review and personalize reports.",
    "Our client-reporting case study combines an interactive dashboard with editable presentation and spreadsheet exports, leaving publication with the account team.",
    "In our reporting work, the assistant answers from the report itself, and a person decides what reaches the client. The tool is built and ready for the team.",
  ],
  accounts: [
    "For a PE-backed professional-services firm, we put account risk and revenue exposure in one view using existing systems. It reached production in one month.",
    "We delivered an account-health view for a professional-services firm, connecting account ratings with the revenue at risk. It went live in one month.",
    "One of our deployed tools brings account ratings and budget data together, so leaders can see which accounts need attention and the revenue involved.",
  ],
};
export type ProofKind = keyof typeof CASES | "process" | "20-applications";
export function outreachProof(context: string, seed: number): { kind: ProofKind; text: string } {
  const n = Math.abs(Math.trunc(seed));
  if (n % 9 === 0) return { kind: "20-applications", text: DEPLOYED[Math.floor(n / 9) % DEPLOYED.length] };
  let kind: keyof typeof CASES | undefined;
  if (/\b(rfp|proposals|proposal drafting|proposal review|bid|tender)\b/i.test(context)) kind = "proposals";
  else if (/\b(client health|account health|retention|revenue exposure|account risk|renewal|client profitability)\b/i.test(context)) kind = "accounts";
  else if (/\b(reporting|report|reports|dashboard|dashboards|analytics|insights)\b/i.test(context)) kind = "reporting";
  else if (/\b(cfo|chief financial officer|forecast|forecasting|profitability|margin|budget|budgets)\b/i.test(context)) kind = "finance";
  else if (/\b(resource|staffing|capacity|allocation|collaboration)\b/i.test(context)) kind = "delivery";
  if (kind && n % 4 !== 0) return { kind, text: CASES[kind][n % CASES[kind].length] };
  return { kind: "process", text: PROCESS[n % PROCESS.length] };
}
