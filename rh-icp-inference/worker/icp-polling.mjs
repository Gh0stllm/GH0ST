import { polling } from "@icp-sdk/core/agent";

// This bounds waiting for one ingress receipt, not thought generation. A
// timeout remains ambiguous and is reconciled by get_job before another update.
// Construct inside callTransform: SDK timeout clocks start on construction.
export const ICP_POLL_INTERVAL_MS = 1000;
export const ICP_CALL_TIMEOUT_MS = 300_000;
export function coordinatorCallTransform({ strategy = polling.strategy } = {}) {
  return () => ({ pollingOptions: { strategy: strategy.chain(
    strategy.throttle(ICP_POLL_INTERVAL_MS), strategy.timeout(ICP_CALL_TIMEOUT_MS),
  ) } });
}
