/*external modules*/
/*DB*/
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { Contract, ContractPaymentPlan } from '../../../../db/types/contract';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
import { StripeModel } from '../../../../db/models/StripeModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../..';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';

type TArgs = { contractId: string };
type TReturn = Contract;

defMutation<TReturn, TArgs>(
  'archiveContract(contractId: ID!): Contract! @authenticated @contractPaid(path: "contractId")',
  async (_root, args, ctx) => {
    const contract = await ctx.db.getClientTransaction(async client => archiveContract(client, args, ctx));

    await ctx.resolveEvents();

    return contract;
  }
);

export const archiveContract: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentRoleId = ctx.currentUser!.lastRoleId;

  const contract = await ContractModel.findById.exec(client, { contractId: args.contractId }, ctx);
  if (!contract) throw GraphQLError.notFound('contract');

  const hasContractAccess = ctx.sql.contractAccess(contract.id, currentRoleId, {
    minPermission: CollaboratorPermission.Read
  });

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} as "contractAccess"`);
  validateContractAccess(contractAccess);

  await ContractModel.archive.exec(client, { contractId: contract.id, roleId: currentRoleId }, ctx);

  if (contract.paymentPlan === ContractPaymentPlan.MonthlySubscription) {
    await StripeModel.disableMonthlySubscription.exec(client, { contractId: contract.id }, ctx);
  }

  ctx.events.push(() => publishContractUpdated(contract));

  return contract;
};
