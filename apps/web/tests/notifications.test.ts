import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { sortPool, usePool, type PoolSource } from '@/features/call/notifications';

const item = (id: string, group: PoolSource['group']): PoolSource => ({
  id,
  group,
  tone: 'warn',
  icon: 'pause',
  text: id,
});

describe('sortPool', () => {
  it('puts system before user, newer first inside a group', () => {
    const sorted = sortPool([
      { id: 'u1', group: 'user' as const, since: 1 },
      { id: 's1', group: 'system' as const, since: 2 },
      { id: 'u2', group: 'user' as const, since: 3 },
      { id: 's2', group: 'system' as const, since: 4 },
    ]);
    expect(sorted.map(i => i.id)).toEqual(['s2', 's1', 'u2', 'u1']);
  });
});

describe('usePool', () => {
  const setup = (initial: PoolSource[]) => {
    const source = ref<PoolSource[]>(initial);
    const pool = effectScope().run(() => usePool(() => source.value))!;
    return { source, ids: () => pool.value.map(i => i.id), pool };
  };

  it('shows the latest event of the same group first', async () => {
    const t = setup([item('held', 'user')]);
    t.source.value = [item('held', 'user'), item('cam', 'user')];
    await nextTick();
    expect(t.ids()).toEqual(['cam', 'held']);
  });

  it('keeps a system notification above newer user ones and brings the older back after it is gone', async () => {
    const t = setup([item('held', 'user')]);
    t.source.value = [item('held', 'user'), item('reconnecting', 'system')];
    await nextTick();
    t.source.value = [item('held', 'user'), item('reconnecting', 'system'), item('cam', 'user')];
    await nextTick();
    expect(t.ids()).toEqual(['reconnecting', 'cam', 'held']);
    t.source.value = [item('held', 'user'), item('cam', 'user')];
    await nextTick();
    expect(t.ids()).toEqual(['cam', 'held']);
  });

  it('treats a notification that comes back as new', async () => {
    const t = setup([item('cam', 'user'), item('held', 'user')]);
    t.source.value = [item('held', 'user')];
    await nextTick();
    t.source.value = [item('held', 'user'), item('cam', 'user')];
    await nextTick();
    expect(t.ids()).toEqual(['cam', 'held']);
  });

  it('does not leak group or timing fields into the items', () => {
    const t = setup([item('held', 'user')]);
    expect(Object.keys(t.pool.value[0]!)).not.toContain('group');
    expect(Object.keys(t.pool.value[0]!)).not.toContain('since');
  });
});
