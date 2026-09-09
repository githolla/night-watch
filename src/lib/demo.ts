export const demoCards = [
  {id:"demo-1",status:"new",channel:"linkedin_first",score:94,why_now:"The post is less than 24 hours old and directly names an automation priority.",brief:"Maya leads operations at Northstar Health. She just shared that her team is redesigning intake workflows with AI.",assigned_to:"josh",linkedin_comment:"The handoff design is where these projects usually win or stall. Keeping exception handling visibly human-owned is a smart constraint.",linkedin_note:"Saw your post on rebuilding intake around AI-assisted handoffs. The exception-handling point was especially sharp.",email_subject:"intake handoffs",email_body:"Maya — saw your post about rebuilding intake around AI-assisted handoffs.\n\nOne pattern we’ve seen work is separating routine routing from exception ownership before selecting tools. It keeps the automation useful without making the operating model brittle.\n\nWould a one-page example be useful?",accounts:{name:"Northstar Health"},people:{full_name:"Maya Chen",title:"VP, Operations",email:"maya@northstar.example",email_status:"verified",path_score:6,connection_status:"none",linkedin_url:"https://www.linkedin.com"},signals:{type:"exec_post",summary:"Maya described a company-wide effort to automate patient intake while keeping exception handling human-led.",source_url:"https://www.linkedin.com",observed_at:"2026-09-09",raw:{}}},
  {id:"demo-2",status:"approved",channel:"email_first",score:85,why_now:"Three related roles appeared within fourteen days, signaling funded capacity pressure.",brief:"Andre owns revenue systems at Harbor. The company is hiring three RevOps and CRM roles around the same workflow bottleneck.",assigned_to:"jenna",linkedin_comment:"",linkedin_note:"Noticed Harbor’s RevOps hiring cluster—especially the CRM automation role. Looks like a meaningful systems push.",email_subject:"harbor’s revops build",email_body:"Andre — noticed Harbor opened three RevOps roles, including a CRM automation lead.\n\nWe can map which responsibilities are good agent work, which should stay human, and what that changes in the job design.\n\nWant the free one-page JD teardown?",accounts:{name:"Harbor Systems"},people:{full_name:"Andre Walker",title:"Head of Revenue Operations",email:"andre@harbor.example",email_status:"verified",path_score:0,connection_status:"none",linkedin_url:"https://www.linkedin.com"},signals:{type:"job_cluster",summary:"Harbor posted three RevOps roles: CRM Automation Lead, GTM Systems Analyst, and Revenue Data Manager.",source_url:"https://example.com/careers",observed_at:"2026-09-08",raw:{job:{title:"CRM Automation Lead",days_open:34,tools_named:["Salesforce","Clay","HubSpot"],responsibilities:["Automate lead routing","Own CRM architecture","Improve data quality"]}}}},
  {id:"demo-3",status:"new",channel:"intro",score:80,why_now:"A first-degree path and a newly appointed data leader make a warm introduction timely.",brief:"Priya joined Meridian as its first Chief Data Officer this week and is building the operating roadmap.",assigned_to:"josh",linkedin_comment:"",linkedin_note:"Congrats on the new role at Meridian. The first operating roadmap is a rare chance to make ownership explicit before tooling hardens.",email_subject:"meridian data roadmap",email_body:"Priya — congratulations on joining Meridian as its first CDO.\n\nEarly data roadmaps often benefit from separating governance decisions from repeatable execution before the stack gets locked in.\n\nWould it help if I sent the framework we use?",accounts:{name:"Meridian Foods"},people:{full_name:"Priya Raman",title:"Chief Data Officer",email:"priya@meridian.example",email_status:"verified",path_score:10,connection_status:"connected",linkedin_url:"https://www.linkedin.com"},signals:{type:"new_leader",summary:"Meridian appointed Priya Raman as its first Chief Data Officer to lead data modernization.",source_url:"https://example.com/news",observed_at:"2026-09-07",raw:{}}},
  {id:"demo-4",status:"positive",channel:"linkedin_only",score:72,why_now:"The speaker is reachable through a public event page, but no verified email is available.",brief:"Leo is speaking next week about scaling customer operations without adding support tiers.",assigned_to:"jenna",linkedin_comment:"",linkedin_note:"Your upcoming session on scaling support without more tiers caught my eye. Curious how you’re treating exception ownership.",email_subject:null,email_body:null,accounts:{name:"Aperture Cloud"},people:{full_name:"Leo Martins",title:"Director, Customer Experience",email:null,email_status:"none",path_score:0,connection_status:"requested",linkedin_url:"https://www.linkedin.com"},signals:{type:"event",summary:"Leo is listed as a speaker for an operations summit session on AI-assisted customer support.",source_url:"https://example.com/events",observed_at:"2026-09-06",raw:{}}}
];
export const demoStats={sent:46,replyRate:13,positiveShare:50,meetings:3,cost:38.42,groups:[{name:"job cluster",sent:18,replyRate:17,positiveShare:67},{name:"executive post",sent:14,replyRate:14,positiveShare:50},{name:"new leader",sent:8,replyRate:13,positiveShare:50},{name:"event",sent:6,replyRate:0,positiveShare:0}]};

export const demoDashboard = {
  metrics: { newSignals: 28, surfacedCards: 10, highPriority: 4, positiveReplies: 2 },
  run: { status: "Complete", finishedAt: "06:18", accounts: 286, signals: 28, cards: 10, cost: 4.82, duration: "18m 42s" },
  sources: [
    { name: "Careers", count: 14, share: 50, detail: "8 target roles · 2 clusters", filter: "jobs" },
    { name: "Executive posts", count: 7, share: 25, detail: "4 AI · 2 efficiency · 1 scale", filter: "posts" },
    { name: "Company news", count: 5, share: 18, detail: "2 leaders · 2 funding · 1 market", filter: "news" },
    { name: "Events", count: 2, share: 7, detail: "2 reachable speakers", filter: "events" }
  ],
  pipeline: [
    { name: "Signals found", count: 28, note: "past 48 hours", href: "/?view=signals" },
    { name: "People matched", count: 22, note: "79% match rate", href: "/desk" },
    { name: "Above threshold", count: 13, note: "score 60+", href: "/desk?status=new" },
    { name: "Surfaced today", count: 10, note: "morning queue", href: "/desk" },
    { name: "Approved", count: 3, note: "ready for action", href: "/desk?status=approved" }
  ],
  recentSignals: [
    { id:"s1", type:"Executive post", account:"Northstar Health", summary:"VP Operations outlined an AI-assisted intake redesign with human exception handling.", age:"42m", source:"LinkedIn", sourceUrl:"https://www.linkedin.com", cardId:"demo-1", isNew:true },
    { id:"s2", type:"Job cluster", account:"Harbor Systems", summary:"Three related RevOps and CRM roles opened within fourteen days.", age:"1h", source:"Careers", sourceUrl:"https://example.com/careers", cardId:"demo-2", isNew:true },
    { id:"s3", type:"New leader", account:"Meridian Foods", summary:"First Chief Data Officer appointed to lead the modernization roadmap.", age:"2h", source:"Company news", sourceUrl:"https://example.com/news", cardId:"demo-3", isNew:true },
    { id:"s4", type:"Event", account:"Aperture Cloud", summary:"Customer Experience director announced as an AI support operations speaker.", age:"3h", source:"Event page", sourceUrl:"https://example.com/events", cardId:"demo-4", isNew:true },
    { id:"s5", type:"Funding", account:"Willow Commerce", summary:"Raised a Series B to expand its automation and data teams.", age:"5h", source:"Company news", sourceUrl:"https://example.com/news", cardId:null, isNew:true }
  ],
  accounts: [
    {name:"Northstar Health",signalCount:3,topSignal:"Executive post",score:94,owner:"Josh"},
    {name:"Harbor Systems",signalCount:4,topSignal:"Job cluster",score:85,owner:"Jenna"},
    {name:"Meridian Foods",signalCount:2,topSignal:"New leader",score:80,owner:"Josh"},
    {name:"Aperture Cloud",signalCount:2,topSignal:"Event",score:72,owner:"Jenna"},
    {name:"Willow Commerce",signalCount:1,topSignal:"Funding",score:68,owner:"Josh"}
  ],
  activity: [
    {time:"08:14",label:"Card approved",detail:"Jenna · Harbor Systems"},
    {time:"08:06",label:"Positive reply",detail:"Josh · Northstar Health"},
    {time:"07:58",label:"Card edited",detail:"Josh · Meridian Foods"},
    {time:"07:44",label:"Signal dismissed",detail:"Jenna · wrong person"},
    {time:"07:31",label:"Intro requested",detail:"Josh · Priya Raman"}
  ]
};
