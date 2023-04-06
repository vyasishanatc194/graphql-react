import { defSubscription, pubsub, GraphQLError } from '../../../index';
import { ChangeOrder } from '../../../../db/types/changeOrder';
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { changeOrderUpdatedTopic } from '../../../../notifications/subscriptions/change-orders/updated';
import { DeletedRecord } from '../../DeletedRecord';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

defSubscription<{ contractId: string }, { changeOrderId: string }, ChangeOrder | DeletedRecord>(
  `contractChangeOrdersUpdated(contractId: ID!): ChangeOrderOrDeleted @authenticated`,
  async (_root, { contractId }, ctx) => {
    const hasContractAccess = ctx.sql.contractAccess(contractId, ctx.currentUser!.lastRoleId, {
      minPermission: CollaboratorPermission.Write
    });
    const { rows: contracts }: { rows: WithContractAccess<Contract>[] } = await ctx.db.pool.query(
      ctx.sql`SELECT *,
                     ${hasContractAccess} as "contractAccess"
              FROM ${CONTRACT_TABLE}
              WHERE "id" = ${contractId}`
    );
    const contract = contracts[0];
    if (!contract) throw GraphQLError.notFound();
    validateContractAccess(contract);

    const topic = changeOrderUpdatedTopic({ contractId });
    return pubsub.asyncIterator(topic);
  },
  async ({ changeOrderId }, _args, ctx) => {
    ctx.dataLoader.flush();

    const changeOrder = await ctx.dataLoader('changeOrders').load(changeOrderId);
    if (changeOrder) return changeOrder;

    return {
      id: changeOrderId,
      deleted: true
    };
  }
);
