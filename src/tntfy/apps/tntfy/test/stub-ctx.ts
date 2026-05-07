import { vi, type Mock } from 'vitest';

export type StubCtx = {
  from: { id: number; username?: string; first_name?: string; last_name?: string };
  match?: string;
  user?: { id: string; ext_id: number };
  reply: Mock;
  answerCallbackQuery: Mock;
  editMessageText: Mock;
  callbackQuery?: { id: string; data: string; from: { id: number } };
};

export function makeStubCtx(overrides: Partial<StubCtx> = {}): StubCtx {
  return {
    from: { id: 100, username: 'alice', first_name: 'Alice', last_name: undefined },
    match: '',
    reply: vi.fn(),
    answerCallbackQuery: vi.fn(),
    editMessageText: vi.fn(),
    ...overrides,
  };
}
