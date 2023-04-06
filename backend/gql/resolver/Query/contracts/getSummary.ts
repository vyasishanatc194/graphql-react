/*external modules*/
import _ from 'lodash';
/*DB*/
import { CONTRACT_TABLE } from '../../../../db/types/contract';
/*models*/
/*GQL*/
import { defQuery, GraphQLError } from '../../../index';
import { ContractSummary } from '../../Types/Contract/ContractSummary';
import { calculateContractSummary } from './helpers/calculateContractSummary';
/*other*/
import { TFunction } from '@beyrep/types';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

type TArgs = {
  contractId: string;
  lastActivity: Date;
};
type TReturn = ContractSummary;

defQuery<TReturn, TArgs>(
  `getContractSummary(contractId: ID!): ContractSummary! @authenticated`,
  async (_root, args, ctx) => {
    const contractSummary = await ctx.db.getClient(client => getContractSummary(client, args, ctx));

    await Promise.all(_.map(ctx.events, event => event()));

    return contractSummary;
  }
);

export const getContractSummary: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const roleId = ctx.currentUser!.lastRoleId;
  const { contractId } = args;

  const hasContractAccess = ctx.sql.contractAccess(contractId, roleId);
  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(
    ctx.sql`
      SELECT ${hasContractAccess} as "contractAccess"
      FROM ${CONTRACT_TABLE} contract
      WHERE contract."id" = ${contractId}
    `
  );
  if (!contractAccess) throw GraphQLError.notFound('contract');
  validateContractAccess(contractAccess);

  return calculateContractSummary(client, args, ctx);
};
