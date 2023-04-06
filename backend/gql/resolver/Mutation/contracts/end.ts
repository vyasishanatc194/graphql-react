/*external modules*/
import _ from 'lodash';
import async from 'async';
/*DB*/
import { UserRole } from '../../../../db/types/role';
import { Phase, PHASE_TABLE } from '../../../../db/types/phase';
import { Payment, PAYMENT_TABLE } from '../../../../db/types/payment';
import { Contract, CONTRACT_TABLE, ContractPaymentPlan, ContractStatus } from '../../../../db/types/contract';
import { TASK_TABLE } from '../../../../db/types/task';
import { ContractCompletionType } from '../../../../db/types/contractCompletion';
/*models*/
import { EsignModel } from '../../../../db/models/EsignModel';
import { PaymentModel } from '../../../../db/models/PaymentModel';
import { ContractCompletionModel } from '../../../../db/models/ContractCompletionModel';
import { ContractModel } from '../../../../db/models/ContractModel';
import { StripeModel } from '../../../../db/models/StripeModel';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
/*GQL*/
import { defMutation, GraphQLError } from '../../../index';
import { EsignInput } from '../../EsignInput';
import { validEsign } from '../../../checks/validEsign';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
/*services*/
/*other*/
import { TFunction } from '@beyrep/types';
import jobWorker from '../../../../jobs';
import { sendNotification } from '../../../../notifications';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';
import { publishPaymentsUpdated } from '../../../../notifications/subscriptions/payments/updated';

type TArgs = {
  contractId: string;
  esign?: EsignInput;
  reason: string;
  partialPayment: boolean;
};
type TReturn = Contract;

defMutation<TReturn, TArgs>(
  `endContract(
    contractId: ID!,
    esign: EsignInput,
    reason: String!,
    partialPayment: Boolean!
  ): Contract! @authenticated @contractPaid(path: "contractId")`,
  async (_root, args, ctx) => {
    const currentUserRoleId = ctx.currentUser!.lastRoleId;

    if (!args.partialPayment) {
      if (!args.esign) {
        throw new GraphQLError('Esign is invalid');
      }

      const role = await ctx.dataLoader('roles').loadStrict(currentUserRoleId);
      if (role.name === UserRole.Pro) {
        throw new GraphQLError('Pro can end contract only with partial payment');
      }
    }

    if (args.esign) {
      await validEsign({ esign: args.esign }, ctx);
    }

    const endedContract = await ctx.db.getClientTransaction<Contract>(client => endContract(client, args, ctx));

    await ctx.resolveEvents();

    return endedContract;
  }
);

export const endContract: TFunction.GraphqlClientBasedResolver.ReturnRequired<
  TArgs & { type?: ContractCompletionType },
  TReturn
> = async (client, args, ctx) => {
  const currentUserRoleId = ctx.currentUser?.lastRoleId;

  const endContractType = args.type ?? ContractCompletionType.User;
  const isUserEndContract = endContractType === ContractCompletionType.User;

  if (endContractType === ContractCompletionType.User) {
    const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentUserRoleId!, {
      minPermission: CollaboratorPermission.Full,
      checkContractEnded: true
    });

    const {
      rows: [contractAccess]
    } = await client.query<WithContractAccess>(
      ctx.sql`
      SELECT ${hasContractAccess} as "contractAccess"
      FROM ${CONTRACT_TABLE}
      WHERE "id" = ${args.contractId}
    `
    );
    if (!contractAccess) throw GraphQLError.notFound('contract');
    validateContractAccess(contractAccess);
  }

  const contract = await ContractModel.update.exec(
    client,
    {
      id: args.contractId,
      status: ContractStatus.Completed
    },
    ctx
  );
  if (!contract) throw GraphQLError.notFound(`contract`);

  ctx.events.push(() => publishContractUpdated(contract));

  if (!args.partialPayment && isUserEndContract) {
    const {
      rows: [phaseToPayout]
    } = await client.query<Phase & { payments: Payment[] }>(
      ctx.sql`
        SELECT phases.*,
               json_agg(payments.*) AS "payments"
        FROM ${PHASE_TABLE} phases
          INNER JOIN ${TASK_TABLE} tasks ON tasks."phaseId" = phases."id"
          INNER JOIN ${PAYMENT_TABLE} payments ON payments."id" = tasks."paymentId"
        WHERE phases."contractId" = ${contract.id}
          AND payments."payoutId" ISNULL
        GROUP BY phases."id"
      `
    );

    if (phaseToPayout) {
      const esignData: EsignModel.create.TArgs = {
        roleId: currentUserRoleId!,
        signature: args.esign!.signature
      };

      const esign = await EsignModel.create.exec(client, esignData, ctx);

      const paymentIds = _.map(phaseToPayout.payments, 'id');
      const { rows: updatedPayments } = await client.query<Pick<Payment, 'id'>>(
        ctx.sql`
                UPDATE ${PAYMENT_TABLE}
                SET "esignId" = ${esign.id},
                    "payoutRequestedAt" = ${new Date()}
                WHERE "id" = ANY(${paymentIds})
                  AND "payoutRequestedAt" ISNULL
                RETURNING "id"
              `
      );
      _.forEach(updatedPayments, payment =>
        ctx.events.push(() => publishPaymentsUpdated({ paymentId: payment.id, contractId: contract.id }))
      );

      const jobIds = await PaymentModel.getJobIds.exec(
        client,
        {
          payments: paymentIds
        },
        ctx
      );

      if (_.isEmpty(jobIds)) {
        const job = await jobWorker.getQueue('release-payout').add({ payments: paymentIds });

        const updatedPaymentIds = _.map(updatedPayments, 'id');
        await Promise.all(
          _.map(paymentIds, async paymentId => {
            await PaymentModel.update.exec(
              client,
              {
                id: paymentId,
                externalJobId: String(job.id)
              },
              ctx
            );

            if (!_.includes(updatedPaymentIds, paymentId)) {
              ctx.events.push(() => publishPaymentsUpdated({ paymentId, contractId: contract.id }));
            }
          })
        );
      } else {
        const { rows: jobPayments } = await client.query<Pick<Payment, 'id'>>(
          ctx.sql`
            SELECT "id"
            FROM ${PAYMENT_TABLE}
            WHERE "externalJobId" = ANY(${jobIds})
          `
        );

        const diff = _.difference(_.map(jobPayments, 'id'), paymentIds);

        if (_.isEmpty(diff)) {
          await async.each(jobIds, async jobId => {
            const payoutJob = await jobWorker.getQueue('release-payout').getJob(jobId);

            if (payoutJob) {
              const jobState = await payoutJob.getState();

              switch (jobState) {
                case 'waiting':
                case 'delayed': {
                  ctx.events.push(async () => payoutJob.promote());

                  break;
                }
                case 'failed': {
                  ctx.events.push(async () => payoutJob.retry());

                  break;
                }
              }
            }
          });
        } else {
          throw new GraphQLError(`You must release only requested tasks.`);
        }
      }
    }
  }

  if (contract.paymentPlan === ContractPaymentPlan.MonthlySubscription) {
    await StripeModel.disableMonthlySubscription.exec(client, { contractId: contract.id }, ctx);
  }

  await ContractCompletionModel.create.exec(
    client,
    {
      contractId: contract.id,
      initiatedById: currentUserRoleId,
      partialPayment: args.partialPayment,
      reason: args.reason,
      type: endContractType
    },
    ctx
  );

  ctx.events.push(() => sendNotification('contractEnded', { contractId: contract.id }));

  return contract;
};
