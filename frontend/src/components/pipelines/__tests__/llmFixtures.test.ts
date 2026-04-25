// frontend/src/components/pipelines/__tests__/llmFixtures.test.ts
//
// Deterministic scoring of the prompt-aware fixture matcher. See
// `mock/llmFixtures.ts` for the scoring algorithm.

import { describe, test, expect } from 'vitest';
import { LLM_FIXTURES, pickFixture } from '../mock/llmFixtures';

describe('pickFixture', () => {
  test('prompt mentioning "summarize" picks a summary-* fixture', () => {
    const fixture = pickFixture(
      'You are a concise assistant.',
      'Please summarize the following document in a few sentences.',
    );
    expect(fixture.id.startsWith('summary-')).toBe(true);
  });

  test('prompt mentioning tl;dr picks a summary-* fixture', () => {
    const fixture = pickFixture('You produce tl;dr style outputs.', 'TL;DR please.');
    expect(fixture.id.startsWith('summary-')).toBe(true);
  });

  test('prompt mentioning "extract tags" picks json-tags', () => {
    const fixture = pickFixture(
      'Extract tags from the text.',
      'Please categorize and classify the passage into tags.',
    );
    expect(fixture.id).toBe('json-tags');
  });

  test('prompt asking for JSON extraction picks json-extract', () => {
    const fixture = pickFixture(
      'You are a structured extraction assistant.',
      'Extract the key fields from this article as JSON matching the schema.',
    );
    expect(fixture.id).toBe('json-extract');
  });

  test('translation prompt picks translate', () => {
    const fixture = pickFixture(
      'You are a translator.',
      'Translate the following text into Spanish.',
    );
    expect(fixture.id).toBe('translate');
  });

  test('sentiment prompt picks sentiment', () => {
    const fixture = pickFixture(
      'You analyze text tone.',
      'What is the sentiment of this review?',
    );
    expect(fixture.id).toBe('sentiment');
  });

  test('action items prompt picks action-items', () => {
    const fixture = pickFixture(
      'You extract action items.',
      'List the action items from this meeting transcript.',
    );
    expect(fixture.id).toBe('action-items');
  });

  test('moderation prompt picks moderation', () => {
    const fixture = pickFixture(
      'You enforce content policy.',
      'Is this message safe under the moderation rules?',
    );
    expect(fixture.id).toBe('moderation');
  });

  test('email draft prompt picks email-draft', () => {
    const fixture = pickFixture(
      'You draft professional emails.',
      'Draft a reply email to the customer.',
    );
    expect(fixture.id).toBe('email-draft');
  });

  test('markdown doc prompt picks markdown-doc', () => {
    const fixture = pickFixture(
      'You produce markdown documentation.',
      'Write a README in markdown for this module.',
    );
    expect(fixture.id).toBe('markdown-doc');
  });

  test('no match falls back to generic', () => {
    const fixture = pickFixture(
      'You are a helpful bot.',
      'Hello there, how are you today.',
    );
    expect(fixture.id).toBe('generic');
  });

  test('empty prompts fall back to generic', () => {
    const fixture = pickFixture('', '');
    expect(fixture.id).toBe('generic');
  });

  test('scoring is deterministic — same input yields same fixture every time', () => {
    const system = 'You summarize long-form reports.';
    const user = 'Provide a detailed summary of the document below.';
    const first = pickFixture(system, user);
    for (let i = 0; i < 20; i++) {
      expect(pickFixture(system, user).id).toBe(first.id);
    }
  });

  test('library exposes at least 12 fixtures including a generic fallback', () => {
    expect(LLM_FIXTURES.length).toBeGreaterThanOrEqual(12);
    expect(LLM_FIXTURES.some((f) => f.id === 'generic')).toBe(true);
    // Every fixture produces a non-empty response.
    for (const f of LLM_FIXTURES) {
      expect(f.response.length).toBeGreaterThan(0);
    }
  });

  test('fixture ids are unique', () => {
    const ids = LLM_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('tiebreaker prefers longer response when scores are equal', () => {
    // Both summary-short and summary-long match "summarize". The long form's
    // response is longer, so it should win on equal scores. To isolate that
    // case we craft a prompt that matches only "summarize" in both.
    const fixture = pickFixture('', 'summarize');
    // If both score identically (just the one "summarize" token), we expect
    // the longer of the two summary fixtures.
    const candidates = LLM_FIXTURES.filter((f) => f.matchers.includes('summarize'));
    const longest = [...candidates].sort((a, b) => b.response.length - a.response.length)[0]!;
    expect(fixture.id).toBe(longest.id);
  });

  test('word-boundary bonus breaks close calls — "json" token beats substring-only', () => {
    // "json" appears as a standalone token, so json-extract should win over
    // fixtures that only share weaker matchers.
    const fixture = pickFixture('Return JSON.', 'Produce a JSON object.');
    expect(fixture.id).toBe('json-extract');
  });
});
