/*external modules*/
import _ from 'lodash';
/*DB*/
import { CHANGE_ORDER_TABLE } from '../../../../db/types/changeOrder';
import { PAYMENT_TABLE } from '../../../../db/types/payment';
import { Task, TASK_TABLE } from '../../../../db/types/task';
import { PHASE_TABLE } from '../../../../db/types/phase';
import { ContractActivityType } from '../../../../db/types/contractActivity';
import { PaymentHistoryAction } from '../../../../db/types/paymentHistory';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
import { DECISION_TABLE } from '../../../../db/types/decision';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
import { PaymentModel } from '../../../../db/models/PaymentModel';
import { TaskModel } from '../../../../db/models/TaskModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../..';
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
import { SeenContractActivityInput } from '../../Types/Contract/inputs/SeenContractActivityInput';
import { ContractActivityView } from '../../Types/Contract/Activity/ContractActivityView';
/*other*/
import { TFunction } from '@beyrep/types';

type TArgs = { input: SeenContractActivityInput };
type TReturn = Array<Omit<ContractActivityView, 'role'>>;

defMutation<TReturn, TArgs>(
  'seenContractActivity(input: SeenContractActivityInput!): [ContractActivityView!]! @authenticated',
  async (_root, args, ctx) => {
    const contract = await ctx.db.getClientTransaction(async client => seenContractActivity(client, args, ctx));

    await Promise.all(_.map(ctx.events, event => event()));

    return contract;
  }
);

export const seenContractActivity: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const { input } = args;

  if (_.every(input, value => _.isEmpty(value))) throw new GraphQLError(`No provided data to update`);
  if (_.size(input) > 1) throw new GraphQLError(`Too many arguments`);

  const currentUserRoleId = ctx.currentUser!.lastRoleId;
  const seenAt = new Date();

  const hasContractAccess = ctx.sql.contractAccess(ctx.sql.raw`contracts."id"`, currentUserRoleId, {
    minPermission: CollaboratorPermission.Read
  });

  const [seenChangeOrders, seenPayments, seenDecisions, seenTask] = [
    _.size(input.changeOrders) > 0,
    _.size(input.payments) > 0,
    _.size(input.decisions) > 0,
    'taskId' in input
  ];

  switch (true) {
    case seenChangeOrders: {
      const { rows: contracts } = await client.query<WithContractAccess<Contract>>(
        //language=PostgreSQL
        ctx.sql`
          SELECT DISTINCT ON (contracts."id") contracts.*,
                 ${hasContractAccess} as "contractAccess"
          FROM ${CHANGE_ORDER_TABLE} change_orders
            INNER JOIN ${CONTRACT_TABLE} contracts ON contracts."id" = change_orders."contractId"
          WHERE change_orders."id" = ANY(${input.changeOrders})
        `
      );
      if (_.size(contracts) < 1) throw GraphQLError.notFound('Change Orders');
      if (_.size(contracts) > 1) throw new GraphQLError('All Change Orders must be related to single contract');

      validateContractAccess(contracts[0]);

      break;
    }
    case seenDecisions: {
      const { rows: tasks } = await client.query<WithContractAccess<Task>>(
        //language=PostgreSQL
        ctx.sql`
          SELECT DISTINCT tasks.*,
                 ${hasContractAccess} as "contractAccess"
          FROM ${DECISION_TABLE} decisions
            INNER JOIN ${TASK_TABLE} tasks
                INNER JOIN ${PHASE_TABLE} phases
                    INNER JOIN ${CONTRACT_TABLE} contracts ON contracts."id" = phases."contractId"
                ON phases."id" = tasks."phaseId"
            ON tasks."id" = decisions."taskId"
          WHERE decisions."id" = ANY(${input.decisions})
        `
      );
      if (_.size(tasks) < 1) throw GraphQLError.notFound('decisions');
      if (_.size(tasks) > 1) throw new GraphQLError('All Decisions must be related to single task');

      TaskModel.UtilDataLoader.prime(tasks, ctx);

      validateContractAccess(tasks[0]);

      break;
    }
    case seenPayments: {
      const { rows: contracts } = await client.query<WithContractAccess<Contract>>(
        //language=PostgreSQL
        ctx.sql`
          SELECT DISTINCT contracts.*,
                 ${hasContractAccess} as "contractAccess"
          FROM ${PAYMENT_TABLE} payments
            INNER JOIN ${TASK_TABLE} tasks
                INNER JOIN ${PHASE_TABLE} phases
                    INNER JOIN ${CONTRACT_TABLE} contracts ON contracts."id" = phases."contractId"
                ON phases."id" = tasks."phaseId"
            ON tasks."paymentId" = payments."id"
          WHERE payments."id" = ANY(${input.payments})
        `
      );
      if (_.size(contracts) < 1) throw GraphQLError.notFound('payments');
      if (_.size(contracts) > 1) throw new GraphQLError('All payments must be related to single contract');

      validateContractAccess(contracts[0]);

      break;
    }
    case seenTask: {
      const {
        rows: [contract]
      } = await client.query<WithContractAccess<Contract>>(
        //language=PostgreSQL
        ctx.sql`
          SELECT contracts.*,
                 ${hasContractAccess} as "contractAccess"
          FROM ${TASK_TABLE} tasks
            INNER JOIN ${PHASE_TABLE} phases
                INNER JOIN ${CONTRACT_TABLE} contracts ON contracts."id" = phases."contractId"
            ON phases."id" = tasks."phaseId"
          WHERE tasks."id" = ${input.taskId}
        `
      );
      if (!contract) throw GraphQLError.notFound('task');
      validateContractAccess(contract);

      break;
    }
  }

  let results!: TReturn;
  switch (true) {
    case seenPayments: {
      results = await PaymentModel.seenActivity.exec(
        client,
        {
          roleId: currentUserRoleId,
          payments: input.payments!,
          actions: [PaymentHistoryAction.PayoutRequested, PaymentHistoryAction.PayoutApproved],
          seenAt
        },
        ctx
      );
      break;
    }
    case seenChangeOrders: {
      results = await ContractModel.seenActivity.exec(
        client,
        {
          roleId: currentUserRoleId,
          changeOrders: input.changeOrders!,
          types: [
            ContractActivityType.ChangeOrderNew,
            ContractActivityType.ChangeOrderEdited,
            ContractActivityType.ChangeOrderApproved,
            ContractActivityType.ChangeOrderDeclined
          ],
          seenAt
        },
        ctx
      );

      break;
    }
    case seenDecisions: {
      results = await ContractModel.seenActivity.exec(
        client,
        {
          roleId: currentUserRoleId,
          decisions: input.decisions!,
          types: [ContractActivityType.TaskDecisionSubmit, ContractActivityType.TaskDecisionMake],
          seenAt
        },
        ctx
      );

      break;
    }
    case seenTask: {
      results = await ContractModel.seenActivity.exec(
        client,
        {
          roleId: currentUserRoleId,
          tasks: [input.taskId!],
          types: [ContractActivityType.TaskNew, ContractActivityType.TaskEdited],
          seenAt
        },
        ctx
      );

      break;
    }
  }

  return results;
};
