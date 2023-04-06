/*external modules*/
/*DB*/
import { getClientTransaction } from '../../../../db';
import { Contract, ContractStatus, CONTRACT_TABLE } from '../../../../db/types/contract';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { UserRole } from '../../../../db/types/role';
/*models*/
/*GQL*/
import { defMutation, GraphQLError } from '../../../index';
import { ContractInput } from '../../Types/Contract/inputs/ContractInput';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*others*/
import { TFunction } from '@beyrep/types';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';

type TArgs = {
  contractId: string;
  input: ContractInput;
};
type TReturn = Contract;

defMutation<TReturn, TArgs>(
  `updateContract(
    contractId: ID!,
    input: ContractInput!
  ): Contract! @authenticated @contractPaid(path: "contractId")`,
  async (_root, args, ctx) => {
    const contract = await getClientTransaction<TReturn>(async client => updateContract(client, args, ctx));

    await ctx.resolveEvents();

    return contract;
  }
);

export const updateContract: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const { contractId, input } = args;
  const currentUserRoleId = ctx.currentUser!.lastRoleId;

  const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentUserRoleId, {
    minPermission: CollaboratorPermission.Full,
    role: 'autoReleaseDays' in input ? UserRole.Pro : undefined,
    checkContractEnded: true
  });

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} "contractAccess"`);
  validateContractAccess(contractAccess);

  const setNewValue = ctx.sql.set.newValue;
  const {
    rows: [contract]
  } = await client.query<Contract>(
    ctx.sql`
       UPDATE ${CONTRACT_TABLE}
       SET "name" = ${input.name},
           "workingDays" = ${input.workingDays},
           "autoReleaseDays" = ${setNewValue('autoReleaseDays', input.autoReleaseDays)},
           "relativeDates" = ${input.relativeDates}
       WHERE "id" = ${contractId}
         AND "status" != ${ContractStatus.Hired}
       RETURNING *
    `
  );
  if (!contract) throw GraphQLError.forbidden();

  ctx.events.push(() => publishContractUpdated(contract));

  return contract;
};
