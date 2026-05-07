import { describe, it, expect } from 'vitest';
import { formatError } from './errors';
import {
  InvalidTopicNameError,
  DuplicateTopicError,
  TopicNotFoundError,
} from '../topics/errors';

describe('formatError', () => {
  it('formats InvalidTopicNameError', () => {
    expect(formatError(new InvalidTopicNameError('BAD'))).toMatch(/^topic names must match/);
  });
  it('formats DuplicateTopicError', () => {
    expect(formatError(new DuplicateTopicError('deploys'))).toBe(
      "you already have a topic 'deploys'",
    );
  });
  it('formats TopicNotFoundError', () => {
    expect(formatError(new TopicNotFoundError('deploys'))).toBe(
      "no topic 'deploys', see /list",
    );
  });
  it('falls back for unknown errors', () => {
    expect(formatError(new Error('boom'))).toBe('something went wrong, try again later');
  });
});
