/*external modules*/
/*DB*/
import { Contract } from '../../../../db/types/contract';
import { ContractActivity } from '../../../../db/types/contractActivity';
/*GQL*/
import { defSubscription, GraphQLError, pubsub } from '../../..';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
import { contractActivitiesCreatedTopic } from '../../../../notifications/subscriptions/contracts/activitiesCreated';

type TArgs = {
  contractId: Contract['id'];
};
type TPayload = {
  contractActivities: Array<ContractActivity['id']>;
};
type TReturn = Array<ContractActivity>;

defSubscription<TArgs, TPayload, TReturn>(
  `contractActivitiesCreated(contractId: ID!): [ContractActivity!]! @authenticated`,
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

    const topic = contractActivitiesCreatedTopic(args.contractId);
    return pubsub.asyncIterator(topic);
  },
  (payload, _args, ctx) => {
    ctx.dataLoader.flush();
    return ctx.dataLoader('contractActivities').loadManyStrict(payload.contractActivities);
  }
);
