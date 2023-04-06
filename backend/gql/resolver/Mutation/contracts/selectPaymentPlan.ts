/*external modules*/
/*DB*/
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { Contract, ContractPaymentPlan, ContractStatus } from '../../../../db/types/contract';
import { UserRole } from '../../../../db/types/role';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../..';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';

type TArgs = { contractId: string; plan: ContractPaymentPlan };
type TReturn = Contract;

defMutation<TReturn, TArgs>(
  'selectContractPaymentPlan(contractId: ID!, plan: ContractPaymentPlan!): Contract! @authenticated @contractPaid(path: "contractId")',
  async (_root, args, ctx) => {
    const contract = await ctx.db.getClientTransaction(async client => selectContractPaymentPlan(client, args, ctx));

    await ctx.resolveEvents();

    return contract;
  }
);

export const selectContractPaymentPlan: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentRoleId = ctx.currentUser!.lastRoleId;

  const contract = await ContractModel.findById.exec(
    client,
    {
      contractId: args.contractId
    },
    ctx
  );
  if (!contract) throw GraphQLError.notFound('contract');

  if (contract.status === ContractStatus.Hired) {
    throw new GraphQLError(`Cannot select new payment plan for contract with status "Hired"`);
  }

  const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentRoleId, {
    minPermission: CollaboratorPermission.Full,
    role: UserRole.Pro
  });

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} as "contractAccess"`);
  validateContractAccess(contractAccess);

  const updatedContract = await ContractModel.update.exec(
    client,
    {
      id: contract.id,
      paymentPlan: args.plan
    },
    ctx
  );
  if (!updatedContract) throw new GraphQLError('contract not updated');

  ctx.events.push(() => publishContractUpdated(contract));

  return updatedContract;
};
