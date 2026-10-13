# Relationship explorer

Open `/network` or choose “Explore relationships” on a company page. The map starts with a single company and reads its contacts, message cards, actual sends, replies, bounces, research signals, hiring inputs, employee posts and human-confirmed discoveries. Source URLs become shared evidence nodes. Sender seats connect to their actual deliveries.

Every edge comes from a stored foreign key or confirmed company identity. Matching a person's name, a similar company name or a username does not create an edge. A drafted message without a recorded send does not become an outreach node. Read-only loading neither enriches records, spends model budget nor sends messages.

Interactions include company search, node search, layer filters, selecting and highlighting connections, a direct-relationship inspector, a shortest recorded path from the company, source/record links, drag-to-arrange, background panning, anchored wheel zoom, zoom buttons, centering, fullscreen and resetting. Nodes support keyboard focus and Enter/Space selection. A List view provides an alternative to spatial exploration, and reduced-motion preferences disable transition effects.

The data is intentionally bounded per company: 80 contacts, 80 message cards, 120 deliveries, 50 research signals, 50 jobs, 40 employee posts and 40 confirmed discoveries. When a cap is reached, records fail validation or an optional table cannot be read, the page reports incomplete coverage. Missing records are not silently invented. Counts reflect loaded records, not lifetime totals. The company search shows at most 60 matches.

No new SQL migration or external API approval is needed. Existing authentication protects both the page and `/api/network`. Sources are links already stored in Night Watch, not newly scraped or inferred people. Test fixtures use synthetic `.example` data and are never substituted into a production graph.

Verification includes relationship, source deduplication, suppression state, recorded delivery, path tracing, filter, layout, zoom, data-loading, authorization and server-render tests. An isolated client preview was compiled, and a static graph render was inspected. Live browser interaction inspection was blocked because computer-use permissions were unavailable.
