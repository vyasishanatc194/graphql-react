/*external modules*/
/*DB*/
import {
  Contract,
  ContractStatus,
  CONTRACT_TABLE,
  ContractInviteRefusalReason
} from '../../../../../db/types/contract';
/*models*/
import { ContractModel } from '../../../../../db/models/ContractModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../../../index';
/*other*/
import { TFunction } from '@beyrep/types';
import { sendNotification } from '../../../../../notifications';
import { publishContractUpdated } from '../../../../../notifications/subscriptions/contracts/updated';

type TArgs = {
  contractId: string;
  accept: boolean;
  refusalReason?: ContractInviteRefusalReason;
  refusalMessage?: string;
};
type TReturn = Contract;

const HIGHER_CONTRACT_STATUSES = [
  ContractStatus.PreparingEstimate,
  ContractStatus.WaitingReview,
  ContractStatus.Hired,
  ContractStatus.Completed
];

defMutation<TReturn, TArgs>(
  `answerContractInvite(
    contractId: ID!,
    accept: Boolean!,
    refusalReason: ContractInviteRefusalReason,
    refusalMessage: String
  ): Contract! @authenticated @contractPaid(path: "contractId")`,
  async (_root, args, ctx) => {
    if (!args.accept && !args.refusalReason) {
      throw new GraphQLError('You must provide refusal reason');
    }

    const contract = await ctx.db.getClient(client => answerContractInvite(client, args, ctx));

    await ctx.resolveEvents();

    return contract;
  }
);

const answerContractInvite: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const status = args.accept ? ContractStatus.AcceptedInvite : ContractStatus.NotInterested;

  if (args.accept) {
    const contract = await ContractModel.findById.exec(
      client,
      {
        contractId: args.contractId
      },
      ctx
    );
    if (!contract) throw GraphQLError.notFound('contract');

    if (HIGHER_CONTRACT_STATUSES.includes(contract.status)) {
      throw new GraphQLError(`You cannot set status ${status} because current status higher.`);
    }
  }

  // @NOTE: Validate current statuses?
  const {
    rows: [contract]
  } = await client.query<Contract>(
    ctx.sql`
      UPDATE ${CONTRACT_TABLE}
      SET "status" = ${status},
          "inviteRefusalReason" = ${args.refusalReason},
          "inviteRefusalMessage" = ${args.refusalMessage}
      WHERE "id" = ${args.contractId}
        AND "partnerId" = ${ctx.currentUser!.lastRoleId}
      RETURNING *
    `
  );
  if (!contract) throw GraphQLError.notFound('contract');

  ctx.events.push(() => publishContractUpdated(contract));

  ctx.events.push(() =>
    sendNotification('projectInviteAnswered', {
      contractId: args.contractId
    })
  );

  return contract;
};
