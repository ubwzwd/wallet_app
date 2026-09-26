/**
 * The shell's side of "别把填了一半的表单弄丢" (04 §4.6.5; decision §14.65 g / h).
 *
 * A form's own leave guard (`useLeaveGuard`) listens for `beforeRemove`, which only fires
 * when the form's route is *removed*. The signed-in groups are `Slot`s, though: most of the
 * shell's exits — a sidebar row, a tab, a ledger in the switcher — push another route and
 * simply stop rendering the form, which unmounts it without a word. So the shell asks
 * first, through this small registry:
 *
 *  - a form with unsaved changes registers a guard (`useRegisterLeaveGuard`); at most one
 *    is registered at a time, the latest wins, and unmounting unregisters it;
 *  - every click in the shell that changes page runs through `useGuardedNavigate`, which
 *    asks the registered guard and only then navigates — inside the guard's `pass`, so the
 *    form's own `beforeRemove` listener does not ask the same question a second time;
 *  - a page may also register a back override (`useBackOverride`): the narrow top bar's ‹
 *    then leaves the way the page's own breadcrumb does (`?next=` first), instead of the
 *    generic history-or-parent step.
 *
 * `AppShell` mounts the provider. Outside it (a screen rendered on its own in a test) every
 * hook here is a no-op and navigation goes straight through.
 */
import React from 'react';

/** What a form hands the shell while it has unsaved changes. */
export interface LeaveGuardHandle {
  /** Ask the user; `true` when it is fine to leave. */
  confirm(): Promise<boolean>;
  /**
   * Run the navigation that follows a "yes" with the form's own guard stood down, so it is
   * not asked again.
   */
  pass(go: () => void): void;
}

/** One registration at a time, owned by whoever set it last. */
interface Slot<T> {
  get(): T | null;
  set(owner: object, value: T): void;
  clear(owner: object): void;
}

function createSlot<T>(): Slot<T> {
  let current: { owner: object; value: T } | null = null;
  return {
    get: () => current?.value ?? null,
    set: (owner, value) => {
      current = { owner, value };
    },
    clear: (owner) => {
      if (current?.owner === owner) current = null;
    },
  };
}

interface Registry {
  guard: Slot<LeaveGuardHandle>;
  back: Slot<() => void>;
}

const LeaveGuardContext = React.createContext<Registry | null>(null);

export function LeaveGuardProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [registry] = React.useState<Registry>(() => ({
    guard: createSlot<LeaveGuardHandle>(),
    back: createSlot<() => void>(),
  }));
  return <LeaveGuardContext.Provider value={registry}>{children}</LeaveGuardContext.Provider>;
}

/**
 * Keep `value` registered in `slot` while it is non-null. The registration itself is stable
 * (it reads the latest `value` through a ref), so a new callback identity on every render
 * does not churn it.
 */
function useSlotRegistration<T extends object>(
  pick: (registry: Registry) => Slot<T>,
  value: T | null,
  forward: (latest: React.RefObject<T | null>) => T,
): void {
  const registry = React.useContext(LeaveGuardContext);
  const latest = React.useRef<T | null>(value);
  latest.current = value;
  const owner = React.useRef({}).current;
  const active = value !== null;
  // `pick` and `forward` are module-level functions at every call site below.
  const slot = registry ? pick(registry) : null;
  React.useEffect(() => {
    if (!slot || !active) return;
    slot.set(owner, forward(latest));
    return () => slot.clear(owner);
  }, [slot, active, owner, forward]);
}

const pickGuard = (registry: Registry): Slot<LeaveGuardHandle> => registry.guard;
const forwardGuard = (latest: React.RefObject<LeaveGuardHandle | null>): LeaveGuardHandle => ({
  confirm: () => latest.current?.confirm() ?? Promise.resolve(true),
  pass: (go) => {
    if (latest.current) latest.current.pass(go);
    else go();
  },
});

/** Register this form's guard while `handle` is non-null (i.e. while it is dirty). */
export function useRegisterLeaveGuard(handle: LeaveGuardHandle | null): void {
  useSlotRegistration(pickGuard, handle, forwardGuard);
}

const pickBack = (registry: Registry): Slot<() => void> => registry.back;
const forwardBack =
  (latest: React.RefObject<(() => void) | null>): (() => void) =>
  () =>
    latest.current?.();

/**
 * Make the shell's back button (the narrow top bar's ‹) run `onBack` instead of its own
 * history-or-parent step, while this page is mounted. `onBack` is expected to ask the
 * leave guard itself — the shell does not ask again.
 */
export function useBackOverride(onBack: (() => void) | null): void {
  useSlotRegistration(pickBack, onBack, forwardBack);
}

/** Runs the registered back override, if any; `false` when there is none. */
export function useRunBackOverride(): () => boolean {
  const registry = React.useContext(LeaveGuardContext);
  return React.useCallback((): boolean => {
    const override = registry?.back.get() ?? null;
    if (!override) return false;
    override();
    return true;
  }, [registry]);
}

export type GuardedNavigate = (go: () => void) => void;

/**
 * Wrap a page change: with a guard registered, ask first and go only on a "yes";
 * without one, go at once (synchronously — nothing to wait for).
 */
export function useGuardedNavigate(): GuardedNavigate {
  const registry = React.useContext(LeaveGuardContext);
  return React.useCallback(
    (go) => {
      const guard = registry?.guard.get() ?? null;
      if (!guard) {
        go();
        return;
      }
      void guard.confirm().then((ok) => {
        if (ok) guard.pass(go);
      });
    },
    [registry],
  );
}
