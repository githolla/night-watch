export type DetailView = "contacts" | "outreach" | "research" | "all";
export const detailViews: Array<{ value: DetailView; label: string }> = [{ value: "contacts", label: "Contacts & emails" }, { value: "outreach", label: "Outreach & replies" }, { value: "research", label: "Research & sources" }, { value: "all", label: "All relationships" }];
export function visibleInView(type: string, companyOpen: boolean, view: DetailView) {
  if (type === "company") return true;
  if (!companyOpen) return false;
  if (view === "all") return true;
  if (view === "contacts") return type === "person" || type === "email";
  if (view === "outreach") return ["person", "draft", "outreach", "reply", "bounce"].includes(type);
  return ["signal", "job", "post", "discovery", "source"].includes(type);
}
export function viewForType(type: string): DetailView {
  if (["person", "email"].includes(type)) return "contacts";
  if (["draft", "outreach", "reply", "bounce"].includes(type)) return "outreach";
  if (["signal", "job", "post", "discovery", "source"].includes(type)) return "research";
  return "all";
}

export function entryRingGroup(id: string, type: string): string | null {
  if (!id.startsWith("context:")) return null;
  if (id.includes(":selection")) return type === "date" ? "ENTRY RESEARCH DATE" : type === "source" ? "ENTRY SOURCE" : "WHY ADDED TO THE LIST";
  return type === "source" ? "REVENUE EVIDENCE SOURCE" : null;
}
