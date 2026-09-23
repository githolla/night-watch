import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelectedDraft, wasAutomaticallyArchived } from './curated-card-state.ts';

test('only the operator-selected signal is exempt from automated scoring', () => {
  assert.equal(isSelectedDraft('gwelectric.com', 'operator-shortlist-20260923:gwelectric.com'), true);
  assert.equal(isSelectedDraft('gwelectric.com', 'ordinary-research'), false);
  assert.equal(isSelectedDraft('unselected.com', 'operator-shortlist-20260923:unselected.com'), false);
});
test('recover scoring-job archives without recovering user decisions', () => {
  assert.equal(wasAutomaticallyArchived({ status: 'archived', score_breakdown: { recency: 20, signal_strength: 0, person_fit: 0, relationship_path: 0 } }), true);
  assert.equal(wasAutomaticallyArchived({ status: 'archived', score_breakdown: {} }), true);
  for (const status of ['sent', 'dismissed', 'snoozed', 'replied', 'approved', 'edited'])
    assert.equal(wasAutomaticallyArchived({ status, score_breakdown: {} }), false);
  assert.equal(wasAutomaticallyArchived({ status: 'archived', dismiss_reason: 'Not a fit', score_breakdown: {} }), false);
  assert.equal(wasAutomaticallyArchived({ status: 'archived', score_breakdown: { person_fit: 10 } }), false);
});
