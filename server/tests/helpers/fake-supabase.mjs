/**
 * Fake Supabase client for unit tests — mirrors ONLY the surface the backend
 * uses (auth methods + a minimal chained query builder). Real behaviour is
 * exercised later by tests/live-smoke.mjs against the actual project.
 *
 * Sessions map access-token → { user, access_token, refresh_token } so the
 * getUser / refreshSession / signOut lifecycle can be tested honestly.
 */
export function createFakeSupabase(opts = {}) {
  const state = {
    profiles: new Map(), // id → row
    sellers: new Map(), // profile_id → row
    products: new Map(), // id → row (nested seller/variants/images)
    auditLogs: [], // rows
    users: new Map(), // id → { id, email }
    sessions: new Map(), // access_token → session
    lastSessionToken: null, // token handed to setSession() (for signOut)
    adminCredentials: new Map(), // admin user id → password (create/update)
    storageObjects: new Map(), // "bucket/path" → { bucket, path, bytes, contentType }
    businessIdSeq: 0, // next_business_id() counter (KNCR-/KNSR- prefixes)
  };

  /**
   * Mirrors the real `next_business_id()` sequence generator, which the
   * profiles_assign_identity trigger calls when it awards a business id.
   */
  const nextBusinessId = (prefix) => {
    state.businessIdSeq += 1;
    return `${prefix}${String(state.businessIdSeq).padStart(4, '0')}`;
  };
  const nextSellerBusinessId = () => nextBusinessId('KNSR-');

  // Per-table stores. profiles/seller_profiles/products are the original
  // maps above; every other real table gets its own Map on first use so the
  // admin/orders routes can be tested against genuinely independent rows.
  const tables = new Map([
    ['profiles', state.profiles],
    ['seller_profiles', state.sellers],
    ['products', state.products],
  ]);

  const storeFor = (table) => {
    if (table === 'audit_logs') return null;
    if (!tables.has(table)) tables.set(table, new Map());
    return tables.get(table);
  };

  // Mirror the REAL schema's column defaults (0001_init_schema.sql) so the
  // fake behaves like the live Postgres for rows created via insert/upsert:
  // profiles.role → 'CUSTOMER', profiles.status → 'ACTIVE',
  // seller_profiles.verification_status → 'PENDING'. Explicit values win.
  const DEFAULTS = {
    profiles: { role: 'CUSTOMER', status: 'ACTIVE' },
    seller_profiles: { verification_status: 'PENDING' },
    // Mirror REAL schema DEFAULT expressions (0001_init_schema.sql) so routes
    // written against server-generated numbers behave identically in tests:
    // order_number/txn_ref/return_number come from DB sequences, timestamps
    // from now(), product status from the enum default, etc.
    orders: {
      order_number: 'KS-20260925-0000001',
      placed_at: () => new Date().toISOString(),
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    order_items: {
      created_at: () => new Date().toISOString(),
    },
    products: {
      status: 'DRAFT',
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    product_variants: {
      is_active: true,
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    returns: {
      status: 'REQUESTED',
      return_number: 'RT-20260925-0000001',
      requested_at: () => new Date().toISOString(),
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    refunds: {
      status: 'PENDING',
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    payouts: {
      status: 'SCHEDULED',
      eligible_at: () => new Date().toISOString(),
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    transactions: {
      txn_ref: 'TXN-0000000001',
      status: 'POSTED',
      created_at: () => new Date().toISOString(),
    },
    announcements: {
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    // 0005/0006 verification tables — mirror the REAL schema's server-side
    // generators (uuid keys, NOT_STARTED default, timestamps) so routes that
    // rely on `data[0].id` / the state default behave exactly as on Postgres.
    seller_verifications: {
      id: () => crypto?.randomUUID?.() ?? `gen-${Date.now()}-${Math.random()}`,
      verification_status: 'NOT_STARTED',
      consent_granted: false,
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
    verification_sessions: {
      id: () => crypto?.randomUUID?.() ?? `gen-${Date.now()}-${Math.random()}`,
      status: 'ACTIVE',
      live_frames_accepted: 0,
      created_at: () => new Date().toISOString(),
      updated_at: () => new Date().toISOString(),
    },
  };
  const withDefaults = (table, row) => {
    const base = DEFAULTS[table] ?? {};
    const resolved = {};
    for (const [k, v] of Object.entries(base)) resolved[k] = typeof v === 'function' ? v() : v;
    return { ...resolved, ...row };
  };

  let auditCounter = 0;

  const keyOf = (table, row) => {
    if (table === 'profiles') return row.id;
    if (table === 'seller_profiles') return row.profile_id;
    if (table === 'audit_logs') { auditCounter += 1; return `audit-${auditCounter}`; }
    return row.id;
  };

  const seeded = (user) => {
    state.users.set(user.id, { id: user.id, email: user.email });
    state.sessions.set(`at-${user.id}`, {
      user,
      access_token: `at-${user.id}`,
      refresh_token: `rt-${user.id}`,
    });
  };

  // ── auth surface ────────────────────────────────────────────────────────
  const auth = {
    async signInWithOtp({ email }) {
      if (opts.otpSendError) return { data: {}, error: { message: opts.otpSendError } };
      void email;
      return { data: { user: null }, error: null };
    },

    async verifyOtp({ email, token }) {
      void token;
      if (opts.otpVerifyError) return { data: null, error: { message: opts.otpVerifyError } };
      const user = { id: opts.verifyUserId ?? 'usr-1', email };
      seeded(user);
      return { data: { user, session: state.sessions.get(`at-${user.id}`) }, error: null };
    },

    async getUser(token) {
      if (opts.getUserError && opts.getUserErrorToken === token) {
        return { data: { user: null }, error: { message: opts.getUserError } };
      }
      const session = state.sessions.get(token);
      if (!session) return { data: { user: null }, error: { message: 'Auth session expired' } };
      return { data: { user: session.user }, error: null };
    },

    async refreshSession({ refresh_token }) {
      if (opts.refreshError) return { data: { session: null }, error: { message: opts.refreshError } };
      const found = [...state.sessions.values()].find((s) => s.refresh_token === refresh_token);
      if (!found) return { data: { session: null }, error: { message: 'refresh_token_not_found' } };
      const rotated = {
        user: found.user,
        access_token: `at2-${found.user.id}`,
        refresh_token: `rt2-${found.user.id}`,
      };
      state.sessions.set(rotated.access_token, rotated);
      return { data: { session: rotated, user: found.user }, error: null };
    },

    async signInWithPassword({ email, password }) {
      const account = opts.passwordUsers?.[email];
      if (account && account.password === password) {
        const user = { id: account.id, email };
        seeded(user);
        const session = state.sessions.get(`at-${account.id}`);
        return { data: { user, session }, error: null };
      }
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
    },

    async setSession({ access_token }) {
      state.lastSessionToken = access_token;
      return { data: { session: state.sessions.get(access_token) ?? null }, error: null };
    },

    async signOut() {
      if (state.lastSessionToken) state.sessions.delete(state.lastSessionToken);
      return { error: null };
    },

    admin: {
      async listUsers() {
        return { data: { users: [...state.users.values()] }, error: null };
      },
      async createUser({ email, password }) {
        const id = `admin-${Date.now()}`;
        state.users.set(id, { id, email });
        state.adminCredentials.set(id, password);
        return { data: { user: { id, email } }, error: null };
      },
      async updateUserById(id, attributes) {
        const user = state.users.get(id);
        if (!user) return { data: { user: null }, error: { message: 'user not found' } };
        if (attributes && typeof attributes.password === 'string') {
          state.adminCredentials.set(id, attributes.password);
        }
        state.users.set(id, { ...user, ...attributes });
        return { data: { user: state.users.get(id) }, error: null };
      },
      async getUserById(id) {
        const user = state.users.get(id);
        if (!user) return { data: { user: null }, error: { message: 'user not found' } };
        return { data: { user }, error: null };
      },
      async signOut(id) {
        for (const [token, s] of state.sessions) {
          if (s.user && s.user.id === id) state.sessions.delete(token);
        }
        return { data: {}, error: null };
      },
    },
  };

  // ── minimal chainable query builder ────────────────────────────────────
  const from = (table) => {
    const store = storeFor(table);
    const q = {
      _filters: [],
      _updates: null,
      select() { return q; },
      eq(field, value) { q._filters.push([field, value, 'eq']); return q; },
      in(field, values) { q._filters.push([field, values, 'in']); return q; },
      _rows() {
        let rows = store ? [...store.values()] : [];
        for (const [f, v, op = 'eq'] of q._filters) {
          rows = rows.filter((r) => (op === 'in' ? Array.isArray(v) && v.includes(r[f]) : r[f] === v));
        }
        if (q._updates) {
          for (const r of rows) {
            // ── Model the profiles_assign_identity trigger ────────────────
            // The real database reverts `roles` and `business_id` on any
            // UPDATE that does not change the PRIMARY role, and only honours
            // them inside grant_role_to_profile(). Without this, the fake
            // would let a direct `update({ roles })` succeed, which is exactly
            // why the real bug (seller approval never actually granting the
            // SELLER role) went unnoticed: every unit test passed while
            // production silently reverted the grant. server/tests/pg-harness
            // asserts the same behaviour against a real PostgreSQL.
            if (table === 'profiles' && q._updates.roles && !q._updates.role) {
              Object.assign(r, q._updates, { roles: r.roles, business_id: r.business_id });
            } else {
              Object.assign(r, q._updates);
            }
          }
        }
        if (q._delete && store) {
          // Delete the matching rows by object identity — stores are not
          // always id-keyed (seller_profiles uses profile_id).
          for (const r of rows) {
            for (const [k, v] of [...store.entries()]) {
              if (v === r) store.delete(k);
            }
          }
        }
        return rows;
      },
      async maybeSingle() {
        const rows = q._rows();
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const rows = q._rows();
        if (rows.length !== 1) return { data: null, error: { message: 'row not found' } };
        return { data: rows[0], error: null };
      },
      insert(rows) {
        q._insertBatch = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
        return q;
      },
      upsert(rows) {
        q._upsertBatch = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
        return q;
      },
      update(obj) { q._updates = obj; return q; },
      delete() { q._delete = true; return q; },
      /**
       * The real supabase-js builder is a thenable: `await q` executes the
       * query. Mirror that so every awaited form behaves like PostgREST:
       *   await q.insert(rows)               → stores rows
       *   await q.insert(rows).select('id')  → stores + returns rows
       *   await q.upsert(rows)               → merge-on-conflict semantics
       *   await q.update(obj).eq(...)        → mutates matching rows
       *   await q.select(...).eq(...)        → read filters
       */
      then(resolve, reject) {
        try {
          if (q._insertBatch) {
            const stored = [];
            for (const r of q._insertBatch) {
              // Apply column defaults BEFORE keying/returning so server-generated
              // ids and state (uuid PKs, NOT_STARTED, timestamps) behave like the
              // real Postgres schema for every route that reads data[0].id.
              const full = withDefaults(table, { ...r });
              const key = keyOf(table, full);
              if (store) store.set(key, full);
              else state.auditLogs.push({ id: key, ...full });
              stored.push(full);
            }
            q._insertBatch = null;
            resolve({ data: stored, error: null });
            return;
          }
          if (q._upsertBatch) {
            const stored = [];
            for (const r of q._upsertBatch) {
              // ON CONFLICT DO UPDATE semantics: only the payload columns overwrite
              // the existing row; defaults fill gaps (they must never clobber a
              // stored value such as role='ADMIN').
              const key = keyOf(table, r);
              if (store) {
                const existing = store.get(key) ?? {};
                const merged = withDefaults(table, { ...existing, ...r });
                store.set(key, merged);
                stored.push(merged);
              } else {
                stored.push(r);
              }
            }
            q._upsertBatch = null;
            resolve({ data: stored, error: null });
            return;
          }
          resolve({ data: q._rows(), error: null });
        } catch (e) {
          reject(e);
        }
      },
    };
    return q;
  };

  return {
    anon: { auth },
    service: {
      auth,
      from,
      /**
       * Postgres functions, as reached through PostgREST.
       *
       * Only the functions this codebase actually calls are implemented. An
       * unknown name resolves to a FUNCTION ERROR rather than a silent success,
       * so a typo in a call cannot make a test pass by doing nothing.
       */
      async rpc(name, args = {}) {
        if (name === 'grant_role_to_profile') {
          const { p_user_id: userId, p_role: role } = args;
          if (!role) return { data: null, error: { message: 'grant_role_to_profile: role is required' } };
          const profiles = storeFor('profiles');
          const row = profiles ? [...profiles.values()].find((r) => r.id === userId) : null;
          if (!row) {
            return { data: null, error: { message: `grant_role_to_profile: no profile for user ${userId}` } };
          }
          // Mirrors the trigger's role_grant branch: recompute from the existing
          // roles plus exactly the one role granted, and ignore whatever the
          // caller wrote (the trigger is authoritative, not the caller).
          row.roles = [...new Set([...(row.roles ?? ['CUSTOMER']), role])];
          if (role === 'SELLER' && row.role === 'CUSTOMER' && !/^KNSR-/.test(String(row.business_id ?? ''))) {
            row.business_id = nextSellerBusinessId();
          }
          return { data: userId, error: null };
        }
        return { data: null, error: { message: `unknown rpc: ${name}` } };
      },
      storage: {
        from(bucket) {
          return {
            async upload(path, bytes, uploadOpts = {}) {
              if (opts.storageError) {
                return { data: null, error: { message: 'storage unavailable' } };
              }
              state.storageObjects.set(`${bucket}/${path}`, {
                bucket,
                path,
                bytes,
                contentType: uploadOpts?.contentType ?? null,
              });
              return { data: { path }, error: null };
            },
            async createSignedUrl(path, expiresIn = 3600) {
              if (opts.storageError) {
                return { data: null, error: { message: 'storage unavailable' } };
              }
              return {
                data: { signedUrl: `https://storage.test/sign/${bucket}/${path}?expires=${expiresIn}` },
                error: null,
              };
            },
            async info(path) {
              const obj = state.storageObjects.get(`${bucket}/${path}`);
              if (!obj) return { data: null, error: { message: 'object not found' } };
              return {
                data: {
                  id: `${bucket}/${path}`,
                  name: path.split('/').pop(),
                  metadata: { mimetype: obj.contentType, size: obj.bytes.length },
                },
                error: null,
              };
            },
            async download(path) {
              const obj = state.storageObjects.get(`${bucket}/${path}`);
              if (!obj) return { data: null, error: { message: 'object not found' } };
              return { data: obj.bytes, error: null };
            },
          };
        },
      },
    },
    _state: state,
    helpers: {
      seedProfile: (row) => state.profiles.set(row.id, { ...row }),
      seedSeller: (row) => state.sellers.set(row.profile_id, { ...row }),
      seedProduct: (row) => state.products.set(row.id, { ...row }),
      seedUser: seeded,
      /** Seed a row in any other real table (orders, order_items, refunds,
       *  payouts, announcements, product_variants, product_images, …). */
      seedRow: (table, row) => {
        const store = storeFor(table);
        const key = row.id ?? row.profile_id ?? `${table}-${crypto?.randomUUID?.() ?? Math.random()}`;
        store.set(key, { ...row });
        return key;
      },
      getProfile: (id) => state.profiles.get(id),
      getSellerProfile: (id) => state.sellers.get(id),
      getRow: (table, key) => storeFor(table)?.get(key) ?? null,
      rows: (table) => [...(storeFor(table) ? storeFor(table).values() : [])],
      setProfile: (id, patch) => {
        const existing = state.profiles.get(id) ?? {};
        state.profiles.set(id, { ...existing, ...patch });
      },
      sessionCount: () => state.sessions.size,
      auditCount: () => state.auditLogs.length,
      removeSession: (token) => state.sessions.delete(token),
      adminPassword: (id) => state.adminCredentials.get(id) ?? null,
      storageObjects: () => [...state.storageObjects.values()],
    },
  };
}