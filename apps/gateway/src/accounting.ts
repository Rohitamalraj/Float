import { gatewayCalls, type Database, type NewGatewayCall } from '@float/db';
import { logger } from './logger.js';

/** One row per metered call — revenue-line-2 accounting. Never throws. */
export async function recordGatewayCall(db: Database, row: NewGatewayCall): Promise<void> {
  try {
    await db.insert(gatewayCalls).values(row);
  } catch (err) {
    logger.error({ err }, 'failed to record gateway call');
  }
}
