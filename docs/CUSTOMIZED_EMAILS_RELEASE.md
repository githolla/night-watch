# Customized email release

The signed-in /customized-emails page contains all 443 companies from the supplied nine67-sales-list.csv. More → 443 customized emails opens the page. Every company has a distinct subject and body, including after replacing the company name. Source links and supplied signals are available for review.

The page resolves the authenticated user’s owner and loads that owner’s saved sender profile and connected mailbox. Greeting placeholders {first} and {name} are filled from the name entered for that company. The saved sign-off and signature are included. Internal legacy owner slugs are not displayed as sender names.

These are review drafts. Source claims have not been independently verified. The input has no recipient email addresses. Names entered in the preview are temporary. Copying requires a recipient name. This release does not import or replace cards and does not send mail.

## Audit scope

The earlier pasted email audit identified placeholder subjects, repeated recipient names, generic copy and non-person contacts. The production branch already contains contact validation, per-seat draft composition, greeting settings and draft audit/repair tools. This release preserves those implementations and adds the 443 individually authored company drafts. It does not certify the current contents of the production database: no authenticated production database audit was performed.

## Validation

443 unique company domains, subjects and company-normalized bodies; each body names its company. TypeScript and lint pass. The 34 existing sender and contact-draft tests pass, including sender-specific greetings and distinct colleague drafts.


## Proof-based revision

All 443 drafts now include one relevant proof or delivery-process paragraph. 49 mention the owner-supplied 20-application engagement. Others use relevant public case-study details, application examples from the owner-provided deployment screenshot, or how Nine-67 builds, iterates, trains and deploys. No savings, adoption rates or industry-specific results are invented. The case-study client is not assumed to be the 20-application client.

The deterministic contact writer and AI writing/refinement rules use the same approved evidence. The authenticated administrator's worklist starts a bounded background repair after rendering, with progress/error feedback. It updates untouched and broken drafts only, preserves valid edited/approved drafts and sent history, and checks the old subject/body before writing to avoid overwriting an edit made during the request. No repair is awaited during server rendering. This runs when an administrator next opens the worklist; deployment alone does not certify production rows were updated.
