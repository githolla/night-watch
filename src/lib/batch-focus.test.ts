import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFocus, originalFocus, focusForOwner, batchOwner, reachoutList } from './focus-data.ts';
import { focusedContacts, publishedEmailPatch } from './focused-contact.ts';
import { savedVariants, renderSavedVariant, renderLinkedInVariant, withDefaultLinkedIn } from './outreach-variants.ts';
import { firstTouchErrors } from './first-touch.ts';
import { recipientResearch } from './recipient-research.ts';
import { sortReachouts } from './reachout-sort.ts';
import { authoredSenderDraft } from './authored-sender.ts';

test('each sender gets 25 unique new companies, with the legacy Suuchi seat mapped explicitly', () => {
  const josh = focusForOwner('josh'), suuchi = focusForOwner('jenna');
  assert.equal(josh.length, 25); assert.equal(suuchi.length, 25);
  assert.deepEqual(suuchi, focusForOwner('suuchi'));
  assert.deepEqual(focusForOwner('unknown'), []);
  assert.equal(new Set([...josh, ...suuchi].map(r => r.domain)).size, 50);
  for (const row of batchFocus) {
    assert.ok(!originalFocus.some(old => old.domain === row.domain));
    assert.equal(batchOwner(row.domain), row.assignedOwner === 'josh' ? 'josh' : 'jenna');
    assert.ok(recipientResearch(row.domain, row.buyer.name));
    assert.equal(focusedContacts(row.domain).length, 1);
  }
});
test('all new contacts have three usable, sender-personalized email and LinkedIn choices', () => {
  for (const row of batchFocus) {
    const sender = row.assignedOwner === 'josh' ? 'Josh' : 'Suuchi';
    for (const channel of ['email', 'linkedin'] as const) {
      const variants = savedVariants(row.domain, row.buyer.name, channel);
      assert.deepEqual(variants.map(v => v.id), ['direct-offer', 'concrete-idea', 'delivery-experience']);
      for (const variant of variants) {
        const rendered = channel === 'email' ? renderSavedVariant(variant, row.buyer.name, sender, 'Hello {first},') : renderLinkedInVariant(variant, sender);
        assert.ok(rendered.body.includes(`I'm ${sender} at Nine-67`), row.domain);
        assert.ok(!rendered.body.includes('{sender}'));
        assert.ok(rendered.body.endsWith('?'));
        assert.deepEqual(firstTouchErrors(rendered.subject, rendered.body), [], row.domain);
        assert.ok(rendered.body.length <= 1000);
        if (channel === 'email') assert.ok(rendered.body.startsWith(`Hello ${row.buyer.name.split(' ')[0]},`));
        assert.equal(authoredSenderDraft({ body: rendered.body, domain: row.domain, contactName: row.buyer.name, senderName: sender, greeting: 'Hello {first},', channel }).senderConflict, null);
      }
    }
  }
});
test('new addresses stay unverified and protected existing addresses are untouched', () => {
  for (const row of batchFocus) {
    const patch = publishedEmailPatch(row.domain, row.buyer.name, { email: null });
    assert.equal(patch.email, row.buyer.email, row.domain);
    assert.equal(patch.email_status, 'unverified');
    assert.deepEqual(publishedEmailPatch(row.domain, row.buyer.name, { email: 'saved@example.com', email_status: 'verified' }), {});
    assert.deepEqual(publishedEmailPatch(row.domain, row.buyer.name, { email: null, do_not_contact: true }), {});
  }
});
test('each new list sorts by revenue and LinkedIn fills without replacing manual edits', () => {
  for (const owner of ['josh', 'jenna']) {
    const rows = focusForOwner(owner);
    const cards = rows.map(r => ({ accounts: { name: r.company, domain: r.domain }, people: { full_name: r.buyer.name, email_status: 'unverified' }, status: 'new', linkedin_message: '' }));
    const sorted = sortReachouts([...cards].reverse(), 'revenue-desc');
    assert.deepEqual(sorted.map(c => c.accounts.domain), rows.map(r => r.domain));
    const filled = withDefaultLinkedIn(cards[0], owner === 'josh' ? 'Josh' : 'Suuchi');
    assert.ok(filled.linkedin_message);
    const edited = { ...cards[0], linkedin_message: 'My saved personal note.' };
    assert.equal(withDefaultLinkedIn(edited, 'Josh').linkedin_message, edited.linkedin_message);
  }
});

test('either teammate can select either list without changing list ownership', () => {
  for (const viewer of ['josh', 'jenna'] as const) {
    for (const id of ['josh', 'suuchi'] as const) {
      const selected = reachoutList(id, viewer);
      assert.equal(selected.id, id);
      assert.equal(selected.owner, id === 'josh' ? 'josh' : 'jenna');
      assert.equal(selected.drafts.length, 25);
      for (const company of selected.drafts) assert.equal(batchOwner(company.domain), selected.owner);
    }
    assert.equal(reachoutList('original', viewer).owner, viewer);
    assert.equal(reachoutList('original', viewer).drafts.length, 25);
    assert.ok(reachoutList('original', viewer).drafts.every(row => !originalFocus.some(old => old.domain === row.domain)));
    assert.equal(reachoutList(undefined, viewer).owner, viewer);
    assert.equal(reachoutList('invalid', viewer).owner, viewer);
  }
});
test('viewing the other list renders authored email and LinkedIn with the active sender', () => {
  for (const [viewer, list] of [['Josh', 'suuchi'], ['Suuchi', 'josh']] as const) {
    const selected = reachoutList(list, viewer === 'Josh' ? 'josh' : 'jenna');
    for (const row of selected.drafts) {
      for (const channel of ['email', 'linkedin'] as const) {
        const variant = savedVariants(row.domain, row.buyer.name, channel)[0];
        const stored = channel === 'email' ? renderSavedVariant(variant, row.buyer.name, list === 'josh' ? 'Josh' : 'Suuchi') : renderLinkedInVariant(variant, list === 'josh' ? 'Josh' : 'Suuchi');
        const visible = authoredSenderDraft({ body: stored.body, domain: row.domain, contactName: row.buyer.name, senderName: viewer, channel });
        assert.equal(visible.matched, true);
        assert.equal(visible.senderConflict, null);
        assert.ok(visible.body.includes(`I'm ${viewer} at Nine-67`));
      }
    }
  }
});
