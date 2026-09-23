# Saved email history and open signals

The four authored versions require no AI calls. Selecting a version writes a selection snapshot and sets `cards.active_variant_id`. Manual edits retain that lineage. Exact matches to another authored version override stale lineage. Attribution is scoped to both company and person.

Each send writes a new snapshot before sending, with the actual subject/body, authored revision, version label, edited flag and source. Only a successfully recorded touch links it into analytics. Failed sends and previews have no touch and do not count. Snapshot subject/body are never rewritten. Loading the researched draft clears the selected version pointer.

Storage uses the existing message_experiments/message_variants tables and touches.experiment_variant_id. No new migration is needed. These are single-snapshot records (slot A), not A/B simulations: model `saved-email-v1`, with the actual four-way version metadata in dimensions. They are excluded from Message Lab simulation analytics. A failure to save a snapshot stops sending before calling Gmail.

Copy is clipboard-only. Mark sent is explicitly self-reported. Gmail sends and manual records can be filtered independently. Reports count one opening conversation per sender/card/person, exclude OOO from human replies, and attribute later follow-up replies to that conversation. Edited copies are reported separately. Older, untracked records are not assigned a guessed version. These observational cohorts are not randomized experiments.

New in-app Gmail sends, scheduled sends and send-now follow-ups include a one-pixel image only in the HTML part. The URL contains an encrypted, purpose-bound snapshot token, never a recipient email. The public endpoint validates the token and records only the first GET detection using a compare-and-set on the snapshot experiment's initially empty context. It does not save IPs or user-agent fingerprints. HEAD requests do not record opens. Repeated requests do not inflate the count. The endpoint always returns a no-cache transparent GIF, including for invalid tokens or storage failures.

An open means the image was requested. Proxies, security scanners, forwarded emails and the sender's own email client may trigger it; blocked images may hide a real open. History shows the detection timestamp. Version open rates use the original message only; follow-up detections remain visible on those messages in history. Manual/external sends and old messages have no tracking pixel and cannot be tracked retroactively.

Tests cover exact/edited attribution, sender substitution, wrong-recipient protection, first-send denominators, follow-up deduplication, OOO exclusion, source/date filters and encrypted token validation. The local browser fixture exercises analytics/history display without sending mail. A signed-in production send/receive test is still needed to verify actual Gmail and database behavior together.

## Self-test

Open a contact draft, expand **Test email & tracking**, then choose **Send test to myself**. The server resolves the recipient from the signed-in seat's Gmail connection, ignores recipient/CC overrides, and sends no CCs. Subject begins `[Night Watch test]`. Open that message with images enabled, then choose **Check test status**. The latest test can be recovered after a refresh; status reads are owner- and card-scoped.

Tests store source `test` and never insert touches, update the contact/card, or enroll a cadence. Gmail sent-sync excludes the test subject prefix. Five requests per ten minutes are allowed per sender. Tests use the actual Gmail and pixel paths, but are excluded from prospect analytics.
