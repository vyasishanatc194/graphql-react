/*external modules*/
/*DB*/
import * as db from '../../../../../db/index';
import { redis } from '../../../../../db/redis';
import { CONTRACT_SUMMARY_CACHE } from '../../../../../db/types/contract';
/*models*/
/*GQL*/
import { calculateContractSummary } from './calculateContractSummary';
/*other*/

export async function refreshContractSummaryCache(contractId: string): Promise<void> {
  await redis.del(`${CONTRACT_SUMMARY_CACHE}:${contractId}`);

  const contractSummary = await calculateContractSummary(
    db.pool as any,
    { contractId },
    {
      sql: db.sql,
      events: []
    }
  );

  await redis.set(`${CONTRACT_SUMMARY_CACHE}:${contractId}`, JSON.stringify(contractSummary));
}
