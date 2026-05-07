import { describe, it, expect } from 'vitest';
import { getTestDb } from './db';

describe('test db', () => {
  it('connects and runs a trivial query', async () => {
    const db = getTestDb();
    const result = await db.selectNoFrom([db.fn.countAll<number>().as('n')]).execute();
    expect(Array.isArray(result)).toBe(true);
  });

  it('starts each test with empty tables', async () => {
    const db = getTestDb();
    const users = await db.selectFrom('users').selectAll().execute();
    const topics = await db.selectFrom('topics').selectAll().execute();
    expect(users).toEqual([]);
    expect(topics).toEqual([]);
  });
});
