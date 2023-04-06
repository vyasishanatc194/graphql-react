import { defSubscription, pubsub, GraphQLError } from '../../../index';
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
import { contractUpdatedTopic } from '../../../../notifications/subscriptions/contracts/updated';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

defSubscription<{ contractId: string }, { contractId: string }, Contract>(
  `contractUpdated(contractId: ID!): Contract! @authenticated`,
  async (_root, { contractId }, ctx) => {
    const hasContractAccess = ctx.sql.contractAccess(contractId, ctx.currentUser!.lastRoleId);
    const { rows: contracts }: { rows: WithContractAccess<Contract>[] } = await ctx.db.pool.query(
      ctx.sql`SELECT *,
                     ${hasContractAccess} as "contractAccess"
              FROM ${CONTRACT_TABLE} WHERE "id" = ${contractId}`
    );
    const contract = contracts[0];
    if (!contract) throw GraphQLError.notFound();
    validateContractAccess(contract);

    const topic = contractUpdatedTopic(contract);
    return pubsub.asyncIterator(topic);
  },
  ({ contractId }, _args, ctx) => {
    ctx.dataLoader.flush();
    return ctx.dataLoader('contracts').loadStrict(contractId);
  }
);
