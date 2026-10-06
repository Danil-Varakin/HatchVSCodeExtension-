import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IndexStore } from '../src/navigation/index-store.ts';

interface State {
  readonly v: string;
  readonly failed?: boolean;
  readonly transient?: boolean;
  readonly deps?: readonly string[];
}

interface Harness {
  readonly store: IndexStore<State>;
  /** every build asked for, in order: resolve one to finish it */
  readonly builds: Array<{ readonly key: string; readonly resolve: (state: State) => void }>;
  readonly changes: Array<[string, string | undefined]>;
  shown: boolean;
}

function harness(options: { capacity?: number; auto?: (key: string, n: number) => State } = {}): Harness {
  const h: Harness = {
    builds: [],
    changes: [],
    shown: true,
    store: undefined as unknown as IndexStore<State>,
  };
  const store = new IndexStore<State>(
    {
      build: (key) =>
        new Promise<State>((resolve) => {
          h.builds.push({ key, resolve });
          if (options.auto !== undefined) resolve(options.auto(key, h.builds.length));
        }),
      dependenciesOf: (state) => state.deps ?? [],
      isFailure: (state) => state.failed === true,
      isTransient: (state) => state.transient === true,
      isShown: () => h.shown,
      changed: (key, state) => h.changes.push([key, state?.v]),
      watch: () => {},
    },
    { capacity: options.capacity ?? 8, delayMs: 0 },
  );
  (h as { store: IndexStore<State> }).store = store;
  return h;
}

const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('a build that an invalidation overtakes is not kept: the caller gets one built after it', async () => {
  const h = harness();
  const asked = h.store.get('a.md');
  await settle(0);
  h.store.invalidateAll(); // HEAD moved while the first build was reading the old config
  h.builds[0]!.resolve({ v: 'old config' });
  await settle(0);
  assert.equal(h.builds.length, 2, 'a fresh build replaces the overtaken one');
  h.builds[1]!.resolve({ v: 'new config' });

  assert.equal((await asked).v, 'new config');
  assert.equal((await h.store.view('a.md')).v, 'new config', 'the stale answer never became the known one');
  h.store.dispose();
});

test('a change while building leaves the result stale, and a shown one is rebuilt after the pause', async () => {
  const h = harness();
  const first = h.store.get('a.md');
  await settle(0);
  h.store.touch('a.md'); // typed into while the build ran
  h.builds[0]!.resolve({ v: 'v1' });
  assert.equal((await first).v, 'v1');

  await settle();
  assert.equal(h.builds.length, 2);
  h.builds[1]!.resolve({ v: 'v2' });
  await settle();
  assert.deepEqual(h.changes.at(-1), ['a.md', 'v2']);
  h.store.dispose();
});

test('a dependency that moved while the first build ran makes it stale, though it was named only at the end', async () => {
  const h = harness();
  const first = h.store.get('a.hatch');
  await settle(0);
  h.store.touch('a.cc'); // the code was edited after the build had read it
  h.builds[0]!.resolve({ v: 'read before the edit', deps: ['a.cc'] });
  await first;

  await settle();
  assert.equal(h.builds.length, 2, 'built again');
  h.builds[1]!.resolve({ v: 'after the edit', deps: ['a.cc'] });
  await settle();
  assert.deepEqual(h.changes.at(-1), ['a.hatch', 'after the edit']);
  h.store.dispose();
});

test('a failure is shown to views but never replayed to a command', async () => {
  const h = harness({ auto: (_, n) => (n === 1 ? { v: 'down', failed: true } : { v: 'up' }) });
  assert.equal((await h.store.get('a.md')).v, 'down');
  assert.equal((await h.store.view('a.md')).v, 'down', 'the view keeps what it has');
  assert.equal((await h.store.get('a.md')).v, 'up', 'a command asks again');
  h.store.dispose();
});

test('a transient failure is built again once on its own, not over and over', async () => {
  const h = harness({ auto: () => ({ v: 'service restarting', failed: true, transient: true }) });
  await h.store.get('a.md');
  await settle(50);
  assert.equal(h.builds.length, 2);
  h.store.dispose();
});

test('a stale state nobody looks at is forgotten, not rebuilt', async () => {
  const h = harness({ auto: () => ({ v: 'v1', deps: ['a.cc'] }) });
  h.shown = false;
  await h.store.get('a.md');
  h.store.touch('a.cc');
  await settle();
  assert.equal(h.builds.length, 1);
  assert.deepEqual(h.changes.at(-1), ['a.md', undefined]);
  assert.equal(h.store.isTracked('a.md'), false);
  h.store.dispose();
});

test('the least recently used state goes first, and says it went', async () => {
  const h = harness({ capacity: 2, auto: (key) => ({ v: key }) });
  await h.store.get('a.md');
  await h.store.get('b.md');
  await h.store.get('a.md'); // used again: b is now the oldest
  await h.store.get('c.md');
  assert.ok(h.changes.some(([key, state]) => key === 'b.md' && state === undefined));
  assert.equal(h.store.isTracked('a.md'), true);
  h.store.dispose();
});
