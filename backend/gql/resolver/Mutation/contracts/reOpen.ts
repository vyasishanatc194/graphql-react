/*external modules*/
import _ from 'lodash';
import { Stripe } from 'stripe';
/*DB*/
import { Contract, CONTRACT_TABLE, ContractPaymentPlan, ContractStatus } from '../../../../db/types/contract';
import { Subscription, SubscriptionStatus } from '../../../../db/types/subscription';
import { UserRole } from '../../../../db/types/role';
/*models*/
import { ContractCompletionModel } from '../../../../db/models/ContractCompletionModel';
import { ContractModel } from '../../../../db/models/ContractModel';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { RoleModel } from '../../../../db/models/RoleModel';
import { SubscriptionModel } from '../../../../db/models/SubscriptionModel';
import { StripeModel } from '../../../../db/models/StripeModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../../index';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
import { getCustomerSource } from '../stripes/helpers/getCustomerSource';
/*services*/
import { StripeService } from '../../../../services/stripe/StripeService';
/*other*/
import { TFunction } from '@beyrep/types';
import { logger } from '../../../../logger';
import jobWorker from '../../../../jobs';
import { publishContractUpdated } from '../../../../notifications/subscriptions/contracts/updated';

type TArgs = { contractId: string };
type TReturn = Contract;

defMutation<TReturn, TArgs>(`reOpenContract(contractId: ID!): Contract! @authenticated`, async (_root, args, ctx) => {
  const contract = await ctx.db.getClientTransaction<Contract>(client => reOpenContract(client, args, ctx));

  await Promise.all(_.map(ctx.events, event => event()));

  return contract;
});

export const reOpenContract: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentUserRoleId = ctx.currentUser!.lastRoleId;

  const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentUserRoleId, {
    role: UserRole.Pro,
    minPermission: CollaboratorPermission.Full,
    checkContractEnded: false
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

  const contractCompletions = await ContractModel.getCompletions.exec(
    client,
    {
      contractId: args.contractId
    },
    ctx
  );
  if (_.isEmpty(contractCompletions)) throw GraphQLError.notFound('Contract Completions');

  // TODO: _need check how much time has passed ???

  const [contractCompletion] = contractCompletions;
  await ContractCompletionModel.remove.exec(
    client,
    {
      contractCompletionId: contractCompletion.id
    },
    ctx
  );

  let contract = await ContractModel.update.exec(
    client,
    {
      id: args.contractId,
      status: ContractStatus.Hired
    },
    ctx
  );
  if (!contract) throw new GraphQLError('contract not updated');

  if (contract.paymentPlan === ContractPaymentPlan.MonthlySubscription) {
    const partner = await ContractModel.getPartner.exec(
      client,
      {
        contractId: contract.id
      },
      ctx
    );
    if (!partner) throw GraphQLError.notFound('contract partner');

    if (!partner.role.stripeCustomerId) {
      throw new GraphQLError(`Contract partner hasn\'t the Stripe Customer Account. Can't continue.`);
    }

    const activeSubscription = await RoleModel.getSubscription.exec(
      client,
      {
        roleId: partner.roleId,
        active: true
      },
      ctx
    );

    let subscription!: Subscription;
    if (activeSubscription) {
      const stripeSubscription = await StripeService.stripe.subscriptions!.retrieve(
        activeSubscription.stripeSubscriptionId
      );
      if (!stripeSubscription) throw GraphQLError.notFound('Stripe Subscription');

      try {
        await StripeService.SubscriptionItem.increaseQuantity.exec({
          id: stripeSubscription.items.data[0].id,
          quantity: activeSubscription.quantity + 1
        });
      } catch (e) {
        logger.error(e, `error while update subscription item`);
        throw e;
      }

      let updatedStripeSubscription: Stripe.Subscription;
      try {
        const newMetadata = StripeService.buildMetadata(
          'contracts',
          _.concat(StripeService.parseMetadata('contracts', stripeSubscription.metadata), contract.id)
        );

        updatedStripeSubscription = await StripeService.stripe.subscriptions!.update(stripeSubscription.id, {
          cancel_at_period_end: false,
          metadata: newMetadata
        });
      } catch (e) {
        logger.error(e, `error while update subscription metadata`);
        throw e;
      }

      const updatedSubscription = await SubscriptionModel.update.exec(
        client,
        {
          id: activeSubscription.id,
          quantity: activeSubscription.quantity + 1,
          status: StripeModel.fromStripeEnumView<SubscriptionStatus>(updatedStripeSubscription.status)
        },
        ctx
      );
      if (!updatedSubscription) throw new GraphQLError(`Subscription is not updated`);

      subscription = updatedSubscription;
    } else {
      const paymentMethodId = partner.role.subscriptionPaymentMethodId;
      let sourceId: string | undefined;

      if (!paymentMethodId) {
        ({ sourceId } = await getCustomerSource(partner.role.stripeCustomerId));
      }

      if (!paymentMethodId && !sourceId) {
        logger.warn(
          {
            contractId: contract.id,
            partnerRoleId: partner.roleId
          },
          `Contract partner hasn\'t Subscription Payment Method and Bank Account source`
        );
      }

      const stripeSubscription: Stripe.Subscription = (await StripeService.Subscription.create.exec({
        customer: partner.role.stripeCustomerId,
        quantity: 1,
        metadata: StripeService.buildMetadata('contracts', [contract.id]),
        paymentMethodId,
        sourceId
      }))!;

      subscription = await SubscriptionModel.create.exec(
        client,
        {
          roleId: partner.roleId,
          active: true,
          stripeSubscriptionId: stripeSubscription.id,
          status: StripeModel.fromStripeEnumView<SubscriptionStatus>(stripeSubscription.status),
          quantity: 1,
          accessExpirationDate: new Date(stripeSubscription.current_period_end * 1000)
        },
        ctx
      );
      if (!subscription) throw new GraphQLError(`Subscription not created`);

      contract = await ContractModel.update.exec(
        client,
        {
          id: contract.id,
          paid: true,
          subscriptionId: subscription.id
        },
        ctx
      );
      if (!contract) throw new GraphQLError('contract not updated');
    }

    if (subscription.status !== SubscriptionStatus.Active) {
      ctx.events.push(() => jobWorker.getQueue('check-subscription-paid').add({ contractId: contract!.id }));
    }
  }

  ctx.events.push(() => publishContractUpdated({ id: contract!.id }));

  return contract;
};
