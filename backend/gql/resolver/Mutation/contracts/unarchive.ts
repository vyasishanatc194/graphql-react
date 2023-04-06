/*external modules*/
/*DB*/
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { Contract } from '../../../../db/types/contract';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defMutation } from '../../..';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';

type TArgs = { contractId: string };
type TReturn = Contract;

defMutation<TReturn, TArgs>(
  'unarchiveContract(contractId: ID!): Contract! @authenticated @contractPaid(path: "contractId")',
  async (_root, args, ctx) => {
    const contract = await ctx.db.getClientTransaction(async client => {
      return unarchiveContract(client, args, ctx);
    });

    await ctx.resolveEvents();

    return contract;
  }
);

export const unarchiveContract: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentRoleId = ctx.currentUser!.lastRoleId;

  const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentRoleId, {
    minPermission: CollaboratorPermission.Read
  });

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} as "contractAccess"`);
  validateContractAccess(contractAccess);

  await ContractModel.unarchive.exec(
    client,
    {
      contractId: args.contractId,
      roleId: currentRoleId
    },
    ctx
  );

  const contract = (await ContractModel.findById.exec(
    client,
    {
      contractId: args.contractId
    },
    ctx
  ))!;

  ctx.events.push(() => publishContractUpdated(contract));

  return contract;
};
