/*external modules*/
import _ from 'lodash';
/*DB*/
import { ContractActivity, CONTRACT_ACTIVITY_TABLE } from '../../../../db/types/contractActivity';
/*models*/
/*GQL*/
import { defQuery, GraphQLError } from '../../../index';
/*other*/
import { TFunction } from '@beyrep/types';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

type TArgs = {
  contractId: string;
  lastActivity: Date;
};
type TReturn = ContractActivity[];

defQuery<TReturn, TArgs>(
  `getContractActivities(contractId: ID!, lastActivity: DateTime): [ContractActivity!]! @authenticated`,
  async (_root, args, ctx) => {
    const contractActivities = await ctx.db.getClient(client => getContractActivities(client, args, ctx));

    await Promise.all(_.map(ctx.events, event => event()));

    return contractActivities;
  }
);

export const getContractActivities: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const { contractId, lastActivity } = args;

  const hasContractAccess = ctx.sql.contractAccess(contractId, ctx.currentUser!.lastRoleId);

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} as "contractAccess"`);
  if (!contractAccess) throw GraphQLError.notFound('contract');
  validateContractAccess(contractAccess);

  let lastUpdatedAtWhereBlock = ctx.sql`true`;
  if (lastActivity) {
    lastUpdatedAtWhereBlock = ctx.sql`"updatedAt" >= ${lastActivity}`;
  }

  const { rows: activities } = await client.query<ContractActivity>(
    ctx.sql`
      SELECT *
      FROM ${CONTRACT_ACTIVITY_TABLE}
      WHERE "contractId" = ${contractId}
        AND ${lastUpdatedAtWhereBlock}
      ORDER BY "createdAt" DESC
      LIMIT 40
    `
  );

  return activities;
};
