/*external modules*/
import _ from 'lodash';
/*DB*/
import { Contract, CONTRACT_TABLE } from '../../../../../db/types/contract';
import { Role, ROLE_TABLE } from '../../../../../db/types/role';
import { PROJECT_TABLE } from '../../../../../db/types/project';
import { GraphQLError } from '../../../../errors';
import { CHANGE_ORDER_TABLE, ChangeOrderStatus } from '../../../../../db/types/changeOrder';
import { Phase, PHASE_TABLE } from '../../../../../db/types/phase';
import { Task, TASK_TABLE, TaskStatus } from '../../../../../db/types/task';
import { TASK_VERSION_TABLE, TaskVersion } from '../../../../../db/types/taskVersion';
import { Payment, PAYMENT_TABLE } from '../../../../../db/types/payment';
import { PAYMENT_OPERATION_TABLE, PaymentOperation } from '../../../../../db/types/paymentOperation';
import { USER_VIEW_POINT_TABLE } from '../../../../../db/types/userViewPoint';
import { getTaskTotal } from '../../../../../db/dataUtils/getTaskTotal';
/*models*/
import { TaskModel } from '../../../../../db/models/TaskModel';
/*GQL*/
import { PhasePaymentStatus } from '../../../PhasePaymentStatus';
import { ContractSummary, SeenData, SeenPages } from '../../../Types/Contract/ContractSummary';
/*other*/
import { TFunction } from '@beyrep/types';

type TArgs = { contractId: string };
type TReturn = ContractSummary;

function isBefore(d1: Date, d2: Date) {
  return new Date(d1).getTime() - new Date(d2).getTime() > 0;
}

function isAfter(d1: Date, d2: Date) {
  return new Date(d1).getTime() - new Date(d2).getTime() < 0;
}

export const calculateContractSummary: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const { contractId } = args;

  const {
    rows: [contract]
  } = await client.query<Contract & { partner: Role; owner: Role }>(
    ctx.sql`
      SELECT contract.*,
             row_to_json(partner.*) AS "partner",
             row_to_json(owner.*) AS "owner"
      FROM ${CONTRACT_TABLE} contract
        INNER JOIN ${ROLE_TABLE} partner ON partner."id" = contract."partnerId"
        INNER JOIN ${PROJECT_TABLE} project
            INNER JOIN ${ROLE_TABLE} owner ON owner."id" = project."ownerId"
        ON project."id" = contract."projectId"
      WHERE contract."id" = ${contractId}
    `
  );
  if (!contract) throw GraphQLError.notFound('contract');

  const { rows: views } = await client.query<{ pagesInfo: string; roleId: Role['id'] }>(
    ctx.sql`
    SELECT array_to_json(array_agg(CONCAT("viewPoint", ',', "seenAt"))) AS "pagesInfo", "roleId"
      FROM ${USER_VIEW_POINT_TABLE}
    WHERE "contractId" = ${contractId}
    GROUP BY "roleId";
   `
  );

  const seenPages: SeenPages[] = _.map(views, view => {
    const seen = _.map(view.pagesInfo, pageInfo => {
      const pageData = _.split(pageInfo, ',', 2);
      return { page: pageData[0], seenAt: pageData[1] } as SeenData;
    });
    return { pages: seen, roleId: view.roleId };
  });

  const {
    rows: [{ openChangeOrders, approvedChangeOrders }]
  } = await client.query<{ approvedChangeOrders: number; openChangeOrders: number }>(
    ctx.sql`
      SELECT COUNT(*) FILTER (WHERE "status" = ${ChangeOrderStatus.Open})::INT AS "openChangeOrders",
             COUNT(*) FILTER (WHERE "status" = ${ChangeOrderStatus.Approved})::INT AS "approvedChangeOrders"
      FROM ${CHANGE_ORDER_TABLE}
      WHERE "contractId" = ${contract.id}
    `
  );

  const { rows: phases } = await client.query<Phase>(
    ctx.sql`
      SELECT phase.*
      FROM ${PHASE_TABLE} AS phase
      WHERE phase."contractId" = ${contract.id}
    `
  );

  let total = 0;
  let targetEndDate: Date | undefined;
  let targetStartDate: Date | undefined;
  let initialEndDate: Date | undefined;

  const phasesSummary = [];
  for (const phase of phases) {
    const { rows: phaseTasks } = await client.query<
      Task & { initial?: TaskVersion; payment?: Payment & { charge?: PaymentOperation; payout?: PaymentOperation } }
    >(
      ctx.sql`
            SELECT tasks.*,
                   row_to_json(tversions.*) AS "initial",
                   to_jsonb(payment.*) || jsonb_build_object(
                     'charge', row_to_json(charge.*),
                     'payout', row_to_json(payout.*)
                   ) AS "payment"
            FROM ${TASK_TABLE} tasks
                LEFT JOIN ${PAYMENT_TABLE} payment
                   LEFT JOIN ${PAYMENT_OPERATION_TABLE} charge ON charge."id" = payment."chargeId"
                   LEFT JOIN ${PAYMENT_OPERATION_TABLE} payout ON payout."id" = payment."payoutId"
                ON payment."id" = tasks."paymentId"
                LEFT JOIN ${TASK_VERSION_TABLE} tversions
                ON (
                   tversions."taskId" = tasks."id"
                   AND tversions."version" = (
                      SELECT "firstTaskVersion"."version"
                      FROM ${TASK_VERSION_TABLE} "firstTaskVersion"
                      WHERE "firstTaskVersion"."taskId" = tasks."id"
                        AND "firstTaskVersion"."version" IS NOT NULL
                      ORDER BY "firstTaskVersion"."version" ASC
                      LIMIT 1
                   )
                )
            WHERE tasks."phaseId" = ${phase.id}
      `
    );
    if (_.isEmpty(phaseTasks)) continue;

    TaskModel.UtilDataLoader.prime(phaseTasks, ctx);

    const tasksSummary = [];
    let phaseTotal = 0;
    let totalTodo = 0;
    let totalDoing = 0;
    let totalDone = 0;
    let phaseStartDate = phaseTasks[0].startDate;
    let phaseEndDate = phaseTasks[0].endDate;

    for (const task of phaseTasks) {
      const taskTotal = getTaskTotal(task);
      phaseTotal += taskTotal;

      // All task created by change orders will contain task.initial.changeOrderId
      // If it was a new task created by change order - we must not count endDate and total
      // for the initial total and initial target end date.
      // See: https://github.com/BEYREP/beyrep-web-client/issues/1137
      const isNewTask = task.initial?.changeOrderId;

      const initialTaskEndDate = task.initial
        ? new Date(task.initial.endDate) // row_to_json -> typeof endDate === string
        : task.endDate;

      if (isBefore(phaseStartDate, task.startDate)) {
        phaseStartDate = task.startDate;
      }

      if (isAfter(phaseEndDate, task.endDate)) {
        phaseEndDate = task.endDate;
      }

      if (!isNewTask && (!initialEndDate || isAfter(initialEndDate, initialTaskEndDate))) {
        initialEndDate = initialTaskEndDate;
      }

      if (task.status === TaskStatus.Todo) totalTodo += 1;
      else if (task.status === TaskStatus.Doing) totalDoing += 1;
      else if (task.status === TaskStatus.Done) totalDone += 1;

      let paymentStatus = PhasePaymentStatus.None;
      if (task.payment?.payout) {
        paymentStatus = PhasePaymentStatus.Released;
      } else if (task.payment?.payoutRequestedAt) {
        paymentStatus = PhasePaymentStatus.Requested;
      } else if (task.payment) {
        paymentStatus = PhasePaymentStatus.Funded;
      }

      tasksSummary.push({
        id: task.id,
        paymentStatus,
        name: task.name,
        startDate: task.startDate,
        endDate: task.endDate,
        status: task.status,
        total: taskTotal,
        initialTotal: task.initial ? (isNewTask ? 0 : getTaskTotal(task.initial)) : taskTotal
      });
    }

    if (!targetStartDate || isBefore(targetStartDate, phaseStartDate)) {
      targetStartDate = phaseStartDate;
    }
    if (!targetEndDate || isAfter(targetEndDate, phaseEndDate)) {
      targetEndDate = phaseEndDate;
    }

    let paymentStatus = PhasePaymentStatus.None;
    if (_.every(tasksSummary, task => task.paymentStatus === PhasePaymentStatus.Released)) {
      paymentStatus = PhasePaymentStatus.Released;
    } else if (_.every(tasksSummary, task => task.paymentStatus === PhasePaymentStatus.Requested)) {
      paymentStatus = PhasePaymentStatus.Requested;
    } else if (_.every(tasksSummary, task => task.paymentStatus === PhasePaymentStatus.Funded)) {
      paymentStatus = PhasePaymentStatus.Funded;
    }

    total += phaseTotal;
    phasesSummary.push({
      id: phase.id,
      paymentStatus,
      name: phase.name,
      initialTotal: tasksSummary.reduce((sum, task) => sum + task.initialTotal, 0),
      total: phaseTotal,
      tasks: tasksSummary,
      startDate: phaseStartDate,
      endDate: phaseEndDate,
      totalTodo,
      totalDoing,
      totalDone
    });
  }

  return {
    total,
    phases: phasesSummary,
    owner: contract.owner,
    partner: contract.partner,
    seenPages,
    openChangeOrders,
    approvedChangeOrders,
    targetEndDate: targetEndDate!,
    targetStartDate: targetStartDate!,
    initialEndDate: initialEndDate!,
    createdAt: contract.createdAt
  };
};
