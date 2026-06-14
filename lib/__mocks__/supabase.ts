/**
 * Minimal Supabase mock — supports the query patterns the routes use (select/eq/
 * order/limit/single + insert/update/delete echo) and returns seed data for shared
 * tables. Thenable so `await sb.from(t).select('*')` resolves to { data, error }.
 */
import { MOCK_USER_ID, mockAnswerBank, mockCases } from "@/lib/__mocks__/fixtures";

function rowsFor(table: string): Record<string, unknown>[] {
  if (table === "cases") return mockCases() as unknown as Record<string, unknown>[];
  if (table === "answer_bank") return mockAnswerBank() as unknown as Record<string, unknown>[];
  return [];
}

class MockQuery implements PromiseLike<{ data: unknown; error: null }> {
  constructor(private rows: Record<string, unknown>[]) {}
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Record<string, unknown>) {
    this.rows = this.rows.map((r) => ({ ...r, ...patch }));
    return this;
  }
  delete() {
    this.rows = [];
    return this;
  }
  single() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

export function mockSupabase() {
  const user = { id: MOCK_USER_ID, email: "mock@synthesis.local" };
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: { user } }, error: null }),
      signInWithPassword: async () => ({ data: { user, session: { user } }, error: null }),
      signUp: async () => ({ data: { user, session: { user } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    from(table: string) {
      return new MockQuery(rowsFor(table));
    },
  };
}
