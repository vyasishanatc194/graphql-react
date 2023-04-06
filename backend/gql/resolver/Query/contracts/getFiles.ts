/*external modules*/
/*DB*/
import { File } from '../../../../db/types/file';
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defQuery, GraphQLError } from '../../../index';
import { FilterInput } from '../../Types/File/inputs/FilterInput';
import { OrderByInput } from '../../Types/File/inputs/OrderByInput';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';

type TArgs = { contractId: Contract['id']; filters: FilterInput; orderBy: OrderByInput };
type TReturn = File[];

defQuery<TReturn, TArgs>(
  `getContractFiles(
  contractId: ID!,
  filters: FilterInput,
  orderBy: OrderByInput
  ): [File!]! @authenticated @checkAccessToFiles(behavior: After)`,
  (_root, args, ctx) => {
    return ctx.db.getClient(client => getContractFiles(client, args, ctx));
  }
);

export const getContractFiles: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentUserRoleId = ctx.currentUser!.lastRoleId;
  const { contractId, filters, orderBy } = args;

  const hasContractAccess = ctx.sql.contractAccess(contractId, currentUserRoleId);

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(
    ctx.sql`
      SELECT ${hasContractAccess} AS "contractAccess"
      FROM ${CONTRACT_TABLE}
      WHERE "id" = ${contractId}
    `
  );
  if (!contractAccess) throw GraphQLError.notFound('contract');
  validateContractAccess(contractAccess);

  return ContractModel.getFiles.exec(client, { contractId, filters, orderBy }, ctx);
};
