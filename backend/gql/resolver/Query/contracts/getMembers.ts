/*external modules*/
/*DB*/
import { Role } from '../../../../db/types/role';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defQuery, GraphQLError } from '../../..';
import {
  validateContractAccess,
  WithContractAccess
} from '../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';

type TArgs = {
  contractId: string;
};
type TReturn = Role[];

defQuery<TReturn, TArgs>(
  `getContractMembers(
    contractId: ID! 
  ): [Role!]! @authenticated`,
  async (_root, args, ctx) => {
    return ctx.db.getClient(async client => {
      return getContractMembers(client, args, ctx);
    });
  }
);

export const getContractMembers: TFunction.GraphqlClientBasedResolver.ReturnRequired<
  TArgs,
  TReturn
> = async (client, args, ctx) => {
  const currentUserRoleId = ctx.currentUser!.lastRoleId;
  const { contractId } = args;

  const hasContractAccess = ctx.sql.contractAccess(
    contractId,
    currentUserRoleId
  );

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(
    ctx.sql`
      SELECT ${hasContractAccess} AS "contractAccess"
    `
  );

  if (!contractAccess) throw GraphQLError.notFound('contract');
  validateContractAccess(contractAccess);

  return ContractModel.getMembers.exec(client, { contractId }, ctx);
};
