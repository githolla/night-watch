import test from 'node:test';
import assert from 'node:assert/strict';
import focus from '../../data/revenue-focus.json' with { type: 'json' };
import { curatedDomains } from './curated-worklist.ts';
import { accountBrief } from './dossier-data.ts';
import { recipientResearch } from './recipient-research.ts';
import { publishedEmailPatch } from './focused-contact.ts';
import { withOutreachName } from './outreach-ending.ts';
import { composeContactDraft } from './contact-draft.ts';
import { outreachQualityFailures } from './outreach-quality.ts';
import { lintEmail } from '../../tools/email-writer/src/lint.ts';

test('active revenue focus is supported and excludes the superseded enterprise set', () => {
  assert.equal(focus.length, 25);
  assert.equal(focus.filter(row => row.revenue.status === 'reported').length, 25);
  for (const row of focus) {
    assert.ok(row.revenue.usdMillions >= 10 && row.revenue.usdMillions <= 100);
    assert.ok(row.revenue.sourceUrl.startsWith('https://'));
    assert.match(row.fit, new RegExp(row.revenue.status));
    assert.ok(curatedDomains.includes(row.domain));
    assert.equal(accountBrief(row.domain)?.contacts.length, row.contacts.length);
  }
  for (const domain of ['shure.com', 'gwelectric.com', 'thrivemarket.com', 'quantiphi.com']) assert.ok(!curatedDomains.includes(domain));
});
test('each researched colleague has their own draft and the active sender ending', () => {
  const messages = new Set<string>();
  for (const row of focus) for (const contact of row.contacts) {
    const research = recipientResearch(row.domain, contact.name);
    assert.equal(research?.message, contact.message);
    assert.ok(!messages.has(contact.message)); messages.add(contact.message);
    assert.ok(lintEmail({ touch: 1, subject: contact.subject, body: contact.message }).pass, contact.name);
    assert.deepEqual(outreachQualityFailures(contact.message, { requireIntroduction: true, requireAIPositioning: true, reframe: row.reframe }, contact.subject), [], contact.name);
    for (const sender of ['Josh Lee', 'Suuchi Ramesh']) {
      const draft = composeContactDraft({ company: row.company, domain: row.domain, personName: contact.name, personTitle: contact.title, senderName: sender, greeting: 'Hi {first},', signoff: 'Thank you,' });
      assert.ok(draft.body.includes(contact.message));
      assert.ok(withOutreachName(draft.body, { fromName: sender }).endsWith(sender.split(' ')[0]));
      assert.doesNotMatch(draft.body, /[—–]|Thank you,/);
    }
  }
  assert.equal(messages.size, 28);
});
test('published email evidence cannot become a verified or guessed address', () => {
  const patch = publishedEmailPatch('caymanchem.com', 'Kirk Maxey', { email: null });
  assert.equal(patch.email, 'kmaxey@caymanchem.com');
  assert.equal(patch.email_status, 'unverified');
  assert.equal(patch.email_source, 'https://kirkmaxey.com/about/');
  assert.deepEqual(publishedEmailPatch('caymanchem.com', 'Kirk Maxey', { email: 'current@caymanchem.com', email_status: 'verified', email_source: 'apollo' }), {});
  assert.deepEqual(publishedEmailPatch('caymanchem.com', 'Kirk Maxey', { email: null, do_not_contact: true }), {});
  assert.deepEqual(publishedEmailPatch('mcstamp.com', 'Judith Kucway', { email: null }), {});
  assert.equal(publishedEmailPatch('mcstamp.com', 'Judith Kucway', { email: 'invented@mcstamp.com', email_source: 'guess' }).email, null);
  assert.deepEqual(publishedEmailPatch('channellock.com', 'Someone Else', { email: null }), {});
});
