/*external modules*/
/*DB*/
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { Contract } from '../../../../db/types/contract';
import { UserRole } from '../../../../db/types/role';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../..';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';

type TArgs = { contractId: Contract['id'] };
type TReturn = Contract;

defMutation<TReturn, TArgs>(
  'dismissContractReviewDates(contractId: ID!): Contract! @authenticated @contractPaid(path: "contractId")',
  async (_root, args, ctx) => {
    const contract = await ctx.db.getClientTransaction(async client => dismissContractReviewDates(client, args, ctx));

    await ctx.resolveEvents();

    return contract;
  }
);

export const dismissContractReviewDates: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentRoleId = ctx.currentUser!.lastRoleId;

  const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentRoleId, {
    minPermission: CollaboratorPermission.Full,
    role: UserRole.Pro
  });

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(
    ctx.sql`
      SELECT ${hasContractAccess} as "contractAccess"
    `
  );
  validateContractAccess(contractAccess);

  const contract = await ContractModel.incrementDismissReviewDates.exec(
    client,
    {
      contractId: args.contractId
    },
    ctx
  );
  if (!contract) throw new GraphQLError(`contract not updated`);

  ctx.events.push(() => publishContractUpdated(contract));

  return contract;
};
