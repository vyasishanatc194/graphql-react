/*external modules*/
/*DB*/
import { getClient } from '../../../../db';
import { redis } from '../../../../db/redis';
import { Contract, CONTRACT_SUMMARY_CACHE } from '../../../../db/types/contract';
/*GQL*/
import { defSubscription, GraphQLError, pubsub } from '../../..';
import { ContractSummary } from '../../Types/Contract/ContractSummary';
import { calculateContractSummary } from '../../Query/contracts/helpers/calculateContractSummary';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
import { contractSummaryUpdatedTopic } from '../../../../notifications/subscriptions/contracts/summaryUpdated';

type TArgs = {
  contractId: Contract['id'];
};
type TPayload = {
  contractId: Contract['id'];
};
type TReturn = ContractSummary;

defSubscription<TArgs, TPayload, TReturn>(
  `contractSummaryUpdated(contractId: ID!): ContractSummary! @authenticated`,
  async (_root, args, ctx) => {
    await ctx.db.getClient<void>(async client => {
      const roleId = ctx.currentUser!.lastRoleId;

      const hasContractAccess = ctx.sql.contractAccess(args.contractId, roleId);

      const {
        rows: [contractAccess]
      } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} as "contractAccess"`);
      if (!contractAccess) throw GraphQLError.notFound('contract');
      validateContractAccess(contractAccess);
    });

    const topic = contractSummaryUpdatedTopic(args.contractId);
    return pubsub.asyncIterator(topic);
  },
  async (payload, _args, ctx) => {
    const { contractId } = payload;

    const cache = await redis.get(`${CONTRACT_SUMMARY_CACHE}:${contractId}`);
    if (cache) {
      return JSON.parse(cache) as ContractSummary;
    }

    const contractSummary = await getClient(client => calculateContractSummary(client, { contractId }, ctx));
    await redis.set(`${CONTRACT_SUMMARY_CACHE}:${contractId}`, JSON.stringify(contractSummary));

    return contractSummary;
  }
);
