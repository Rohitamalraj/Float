import { getAddress, parseAbiItem } from 'viem';
import type { Queue } from 'bullmq';
import { logger } from '../logger.js';
import type { EvaluateJob } from '../queues.js';
import { listActiveBusinesses } from '../repo.js';
import type { AgentRuntime } from '../runtime.js';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);
const MANAGED_REFRESH_MS = 60_000;

/**
 * Watches USDC `Transfer`s into every managed smart account and enqueues an
 * `evaluate` job per payment; also enqueues a full re-evaluation on a slow
 * interval as a safety net for missed events.
 */
export function startBalanceWatcher(
  rt: AgentRuntime,
  evaluateQueue: Queue<EvaluateJob>,
): () => void {
  const usdc = getAddress(rt.deployment.usdc);
  /** lowercased smart account -> businessId */
  let managed = new Map<string, string>();
  let unwatch: (() => void) | undefined;
  const log = logger.child({ watcher: 'balance' });

  function resubscribe() {
    unwatch?.();
    unwatch = undefined;
    if (managed.size === 0) return;
    unwatch = rt.publicClient.watchEvent({
      address: usdc,
      event: TRANSFER_EVENT,
      args: { to: [...managed.keys()].map((a) => getAddress(a)) },
      pollingInterval: rt.params.watcherPollIntervalMs,
      onLogs: (logs) => {
        for (const l of logs) {
          const to = l.args.to?.toLowerCase();
          const businessId = to ? managed.get(to) : undefined;
          if (!businessId) continue;
          void evaluateQueue
            .add(
              'evaluate',
              { businessId, reason: `usdc-transfer:${l.transactionHash}` },
              { jobId: `evt:${l.transactionHash}:${l.logIndex}` },
            )
            .catch((err: unknown) => log.error({ err }, 'enqueue on transfer failed'));
        }
      },
      onError: (err) => log.error({ err }, 'watchEvent error'),
    });
    log.info({ accounts: managed.size }, 'subscribed to USDC transfers');
  }

  async function refreshManaged() {
    const list = await listActiveBusinesses(rt.db);
    const next = new Map<string, string>();
    for (const b of list) {
      if (b.smartAccountAddress) next.set(b.smartAccountAddress.toLowerCase(), b.id);
    }
    const changed = next.size !== managed.size || [...next.keys()].some((k) => !managed.has(k));
    managed = next;
    if (changed) resubscribe();
  }

  function enqueueFullSweep() {
    const bucket = Math.floor(Date.now() / rt.params.evaluateIntervalMs);
    for (const businessId of managed.values()) {
      void evaluateQueue
        .add(
          'evaluate',
          { businessId, reason: 'interval' },
          { jobId: `interval:${businessId}:${bucket}` },
        )
        .catch(() => undefined);
    }
  }

  void refreshManaged().catch((err: unknown) => log.error({ err }, 'initial refresh failed'));
  const refreshTimer = setInterval(
    () => void refreshManaged().catch((err: unknown) => log.error({ err }, 'refresh failed')),
    MANAGED_REFRESH_MS,
  );
  const sweepTimer = setInterval(enqueueFullSweep, rt.params.evaluateIntervalMs);

  return () => {
    clearInterval(refreshTimer);
    clearInterval(sweepTimer);
    unwatch?.();
  };
}
