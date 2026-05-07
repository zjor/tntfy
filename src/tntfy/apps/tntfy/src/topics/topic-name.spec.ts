import { describe, it, expect } from 'vitest';
import { TOPIC_NAME_REGEX, validateTopicName } from './topic-name';
import { InvalidTopicNameError } from './errors';

describe('topic-name', () => {
  it('regex matches the spec exactly', () => {
    expect(TOPIC_NAME_REGEX.source).toBe('^[a-z0-9][a-z0-9-_]{1,63}$');
  });

  it.each(['a1', 'deploys', 'app-1', 'foo_bar', '0lead'])('accepts %s', (n) => {
    expect(() => validateTopicName(n)).not.toThrow();
  });

  it.each([
    ['', 'too short'],
    ['a', 'too short'],
    ['-leading', 'leading hyphen'],
    ['UPPER', 'uppercase'],
    ['has space', 'space'],
    ['a'.repeat(65), 'too long'],
  ])('rejects %s (%s)', (n) => {
    expect(() => validateTopicName(n)).toThrow(InvalidTopicNameError);
  });
});
