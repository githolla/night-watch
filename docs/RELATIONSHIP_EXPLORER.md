# Relationship explorer

Open `/network` to see the companies on the signed-in owner's active outreach lists: First 25, Next 25 and the latest ready nightly list. Josh's current nightly list has 10 companies, for 60 target companies in total. Suuchi has a separate list view. Admins can switch owners; members remain scoped to their own lists. Company pages link to the same map, but companies outside these lists do not become target nodes.

Company roots and segment filters render first. Their full stored contacts, message cards, actual sends, replies, bounces, research signals, hiring inputs, employee posts and human-confirmed discoveries load through a separate authenticated request restricted to those company IDs. There is no initial full-database graph. Source URLs become shared evidence nodes, and sender seats connect to actual deliveries. Company selection can independently retrieve a complete company graph and provides explicit loading/error feedback.

Every edge comes from a stored foreign key or confirmed company identity. Matching a person's name, a similar company name or a username does not create an edge. A drafted message without a recorded send does not become an outreach node. Read-only loading neither enriches records, spends model budget nor sends messages.

Interactions include company search, node search, layer filters, selecting and highlighting connections, a direct-relationship inspector, a shortest recorded path from the company, source/record links, drag-to-arrange, background panning, anchored wheel zoom, zoom buttons, centering, fullscreen and resetting. Nodes support keyboard focus and Enter/Space selection. A List view provides an alternative to spatial exploration, and reduced-motion preferences disable transition effects.

The overview reads only active-list accounts, plus revenue research for segment filters. The full target graph and expanded company relationships read company-filtered records in stable ID order, 500 rows per page, four pages at a time, until no rows remain. There is no 60-company search cap or per-company display cap in this view. Companies with `.example` domains are excluded as test records. Missing tables, failed pages and invalid layers produce explicit coverage notices. A failed layer is omitted rather than shown as fully loaded. The single-company API now reads every page without the old per-layer limits. Full research bodies and source nodes are loaded separately for the active target lists, never for every account in the database. Completed company loads are cached in the current browser session; failures preserve the company overview and offer retry through expansion.

Industry, revenue, employee size, account status, owner and outreach stage filters can be combined. Company groups are arranged by industry, with each company's related records orbiting its own root. Company search covers the full inventory. Segment counts reflect the selected companies and their recorded relationships. Shared sources and sender seats remain connected to selected records without pulling unrelated companies into a segment. “Show everything” restores every company, clears filters and cancels pending detail loading. Counts come from the completed target graph. Loading values are shown as pending rather than zero. A list filter selects Today’s list, First 25 or Next 25.

Revenue comes from curated and loaded nightly research, falling back to stored candidate research. Candidate figures remain labeled unconfirmed. Employee-based sizing estimates do not become revenue figures. Values retain their stored year, status and source in the inspector, and missing values are selectable as Unknown. Filters use millions of USD and exclusive upper bounds: under $10M, $10M to $50M, $50M to $100M, $100M to $1B, and $1B or more. These are historical research figures, not refreshed financial reports.

No new SQL migration or external API approval is needed. Existing authentication protects both the page and `/api/network`. Sources are links already stored in Night Watch, not newly scraped or inferred people. Test fixtures use synthetic `.example` data and are never substituted into a production graph.

Verification includes relationship, source deduplication, suppression state, recorded delivery, path tracing, filter, layout, zoom, data-loading, authorization and server-render tests. An isolated client preview was compiled, and a static graph render was inspected. Live browser interaction inspection was blocked because computer-use permissions were unavailable.


A production-data read reproduced a 97,823-node, roughly 88 MB full graph caused mostly by 43,193 jobs and their sources. Scoping the overview to Josh’s actual 10 + 25 + 25 target companies reduced it to roughly 87 KB in 1.6 seconds. Target membership counts were 60 contacts, 60 cards and 56 recorded sends; unrelated database job postings are excluded. These are local read-only measurements against the database, not a deployed browser performance certification.

The complete graph for those 60 targets was also verified against stored data: 385 nodes, 648 edges, roughly 443 KB, loaded in 1.2 seconds with no coverage warnings. The viewer shows this complete target graph after the initial company overview.


## Graph-only presentation

The network page opens directly to the graph chart for all companies on the selected owner's active outreach lists. Company-card, Timeline and List views and summary tiles are absent. Compact company filters, node search, layer controls, pan, zoom, fullscreen and drag-to-arrange remain.

Selecting a node opens a dismissible overlay with its original sources, current addresses, recorded dates and direct relationships. Company selection focuses a circular orbit around that lead, with contacts, current addresses, sources, research and recorded outreach on categorized rings. Returning to all targets keeps the graph visible.

An email-address node represents the current contact record, with `email_source`, `email_status` and `email_verified_at`. It links to its actual person and a safe source URL when one is stored. A send remains linked to the person and card, not to a current address that may have changed after sending. Copying an address does not send an email. Missing verification dates remain unknown.

Timed records display Eastern time and the year. Date-only research records preserve their calendar date. Source cards show linked evidence dates, while the inspector distinguishes those from an unrecorded source publication date. Missing dates are not synthesized.

Validation includes graph-only server rendering for both initial all-target and focused-company views, timestamp formatting, source deduplication, current-address attribution, recorded sends and unique layout positions. A synthetic SVG flow was rasterized and visually inspected offline. Live browser inspection remains unavailable because computer-use access was denied.


## Graph navigation

Double-click a company to open its flow. The navigation strip keeps All targets available and provides Previous/Next controls through companies in the active segment, in their actual list order. Search results show matching records; click a result or press Enter to open its company or center its node. Hover previews display record type, status, dates and contact context.

The default drag action pans the chart. Arrange nodes explicitly enables node repositioning. A drag does not accidentally select the record beneath it. Fit graph restores the visible workspace, and the minimap shows the viewport and supports clicking to move it. Home fits the chart, / focuses search, and Escape clears search and closes the selected details. Pointer calculations account for SVG letterboxing, including wide and tall canvas sizes. Keyboard selection and minimap Enter/Space remain available.


## Circular lead network

Every view now uses a circular constellation, including a focused company. Company hubs sit inside the disk, grouped by industry, recorded revenue or actual outreach list. An inner segmented ring shows the active grouping and can be clicked to filter that industry, revenue band or list. Contacts, current email addresses, original sources, recorded dates, research and outreach occupy distinct sections of the outer ring. Clicking a ring highlights that category and its recorded connections. Hover previews, node selection, double-click to focus, pan/zoom, minimap and keyboard navigation remain. Alt-drag or Arrange nodes repositions an individual node. Reset restores all target companies, filters, layers and the default grouping.

Date nodes are derived from actual stored record dates. Date-only evidence preserves its calendar date; timestamps use Eastern time. Their edges mean “recorded on”, not a business relationship between companies sharing a day. Missing or malformed dates do not create date nodes. Source publication dates remain unknown unless separately stored.

The supporting graph panel contains clickable layers, industry and revenue segments and links to existing outreach, reply and bounce-recovery workspaces. Lead shortcuts use recorded sends, replies, bounces and stored address fields. Bounces on file are historical records, not proof that a replacement address remains bad. Review addresses excludes contacts explicitly marked do not contact. All shortcuts are read-only and do not send, verify, enrich or change restrictions.
