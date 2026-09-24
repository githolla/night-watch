import test from 'node:test';
import assert from 'node:assert/strict';
import variants from '../../data/outreach-variants.json' with { type: 'json' };
import focus from '../../data/revenue-focus.json' with { type: 'json' };
import { authoredSenderDraft } from './authored-sender.ts';
import { renderSavedVariant } from './outreach-variants.ts';

const row = variants.find(row => row.variants.some(variant => variant.message.includes("I'm {sender} at Nine-67")))!;
const variant = row.variants.find(variant => variant.message.includes("I'm {sender} at Nine-67"))!;
const input = { domain: row.domain, contactName: row.contactName, senderName: 'Suuchi Ramesh', greeting: 'Hello {first},' };

test('an unchanged Josh draft is rendered as Suuchi with her greeting', () => {
  const original = renderSavedVariant(variant, row.contactName, 'Josh Lee', 'Hi {first},');
  const result = authoredSenderDraft({ ...input, body: original.body });
  assert.equal(result.matched, true);
  assert.equal(result.senderConflict, null);
  assert.equal(result.body, renderSavedVariant(variant, row.contactName, 'Suuchi Ramesh', 'Hello {first},').body);
  assert.match(result.body, /I'm Suuchi at Nine-67/);
  assert.doesNotMatch(result.body, /I'm Josh/);
});

test('sender changes work in both directions without changing the argument', () => {
  const original = renderSavedVariant(variant, row.contactName, 'Suuchi Ramesh', 'Good morning {first},');
  const result = authoredSenderDraft({ ...input, senderName: 'Josh Lee', greeting: 'Hey {first},', body: original.body });
  assert.equal(result.body, renderSavedVariant(variant, row.contactName, 'Josh Lee', 'Hey {first},').body);
});

test('default copy gets the current contact greeting but not an invented introduction', () => {
  const account = focus[0]; const contact = account.contacts[0];
  const result = authoredSenderDraft({ body: `Hi ${contact.name.split(' ')[0]},\n\n${contact.message}`, domain: account.domain, contactName: contact.name, senderName: 'Suuchi Ramesh', greeting: 'Good afternoon {first},' });
  assert.equal(result.body, `Good afternoon ${contact.name.split(' ')[0]},\n\n${contact.message}`);
  assert.equal(result.matched, true);
});

test('hand edits are kept verbatim and a wrong named introduction is flagged', () => {
  const original = renderSavedVariant(variant, row.contactName, 'Josh Lee');
  const body = original.body.replace('Nine-67', 'Nine-67') + '\n\nI can send you the details we discussed.';
  const result = authoredSenderDraft({ ...input, body });
  assert.equal(result.body, body);
  assert.equal(result.matched, false);
  assert.match(result.senderConflict!, /introduces Josh/);
});

test('custom prose, mentions of a colleague and custom greetings are not rewritten', () => {
  for (const body of ['Hi Victor,\n\nJosh and I discussed your request. Shall I send the notes?', 'A personal note about our conversation.\n\n' + variant.message.replaceAll('{sender}', 'Suuchi'), 'Hi Victor,\n\nI am Suuchi at Nine-67. Would you like the details?']) {
    const result = authoredSenderDraft({ ...input, body });
    assert.equal(result.body, body);
    assert.equal(result.matched, false);
    assert.equal(result.senderConflict, null);
  }
});

test('matching is scoped to the named company and contact', () => {
  const body = renderSavedVariant(variant, row.contactName, 'Josh Lee').body;
  for (const context of [{ ...input, domain: 'unrelated.example' }, { ...input, contactName: 'Someone Else' }]) {
    const result = authoredSenderDraft({ ...context, body });
    assert.equal(result.matched, false);
    assert.equal(result.body, body);
    assert.ok(result.senderConflict);
  }
});


test('an unresolved sender placeholder in edited copy is blocked without overwriting edits', () => {
  const body = variant.message + '\n\nA custom note.';
  const result = authoredSenderDraft({ ...input, body });
  assert.equal(result.body, body);
  assert.match(result.senderConflict!, /sender placeholder/);
});

test('all authored email variants can change sender without changing their selected version', () => {
  for (const contact of variants) for (const saved of contact.variants) {
    const original = renderSavedVariant(saved, contact.contactName, 'Josh Lee');
    const result = authoredSenderDraft({ body: original.body, domain: contact.domain, contactName: contact.contactName, senderName: 'Suuchi Ramesh', greeting: 'Hello {first},' });
    assert.equal(result.matched, true, `${contact.contactName} ${saved.id}`);
    assert.equal(result.body, renderSavedVariant(saved, contact.contactName, 'Suuchi Ramesh', 'Hello {first},').body);
  }
});
