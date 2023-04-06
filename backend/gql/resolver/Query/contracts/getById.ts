/*external modules*/
/*DB*/
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
/*models*/
/*GQL*/
import { defQuery, GraphQLError } from '../../../index';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

type TArgs = { contractId: string };
type TReturn = Contract;

defQuery<TReturn, TArgs>(`getContract(contractId: ID!): Contract! @authenticated`, (_root, args, ctx) => {
  return ctx.db.getClient(async client => {
    const hasContractAccess = ctx.sql.contractAccess(ctx.sql.raw('"id"'), ctx.currentUser!.lastRoleId);

    const {
      rows: [contract]
    } = await client.query<WithContractAccess<Contract>>(
      ctx.sql`
          SELECT *,
                 ${hasContractAccess} as "contractAccess"
          FROM ${CONTRACT_TABLE}
          WHERE "id" = ${args.contractId}
        `
    );
    if (!contract) throw GraphQLError.notFound('contract');
    validateContractAccess(contract);

    return contract;
  });
});
