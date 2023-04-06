/*external modules*/
/*DB*/
import { getClient } from '../../../../db';
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
import { Phase } from '../../../../db/types/phase';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defSubscription, pubsub, GraphQLError } from '../../../index';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
import { phasesUpdatedTopic } from '../../../../notifications/subscriptions/phases/updated';

type TSubscribeArgs = { contractId: string };
type TResolvePayload = { contractId: string };
type TResolveReturn = Phase[];

defSubscription<TSubscribeArgs, TResolvePayload, TResolveReturn>(
  `phasesUpdated(contractId: ID!): [Phase!]! @authenticated`,
  async (_root, { contractId }, ctx) => {
    const hasContractAccess = ctx.sql.contractAccess(contractId, ctx.currentUser!.lastRoleId);
    const {
      rows: [contract]
    } = await ctx.db.pool.query<WithContractAccess<Contract>>(
      ctx.sql`
        SELECT *,
               ${hasContractAccess} AS "contractAccess"
        FROM ${CONTRACT_TABLE}
        WHERE "id" = ${contractId}
      `
    );
    if (!contract) throw GraphQLError.notFound('contract');
    validateContractAccess(contract);

    const topic = phasesUpdatedTopic(contract);
    return pubsub.asyncIterator(topic);
  },
  async ({ contractId }, _args, ctx) => {
    ctx.dataLoader.flush();

    return getClient(client =>
      ContractModel.getPhases.exec(
        client,
        {
          contractId
        },
        ctx
      )
    );
  }
);
