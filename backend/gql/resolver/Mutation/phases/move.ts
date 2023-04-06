/*external modules*/
/*DB*/
import { Phase, PHASE_TABLE } from '../../../../db/types/phase';
import { UserRole } from '../../../../db/types/role';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
/*models*/
import { PhaseModel } from '../../../../db/models/PhaseModel';
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../../index';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';
import { publishPhasesUpdated } from '../../../../notifications/subscriptions/phases/updated';

type TArgs = { phaseId: string; moveTo: number };
type TReturn = Phase[];

defMutation<TReturn, TArgs>(
  'movePhase(phaseId: ID!, moveTo: Int!): [Phase!]! @authenticated @contractPaid(path: "phaseId")',
  async (_root, { phaseId, moveTo }, ctx) => {
    const updatedPhases = await ctx.db.getClientTransaction<Phase[]>(async client => {
      const hasContractAccess = ctx.sql.contractAccess(ctx.sql.raw('"contractId"'), ctx.currentUser!.lastRoleId, {
        minPermission: CollaboratorPermission.Full,
        role: UserRole.Pro,
        checkContractEnded: true
      });

      const {
        rows: [phase]
      } = await client.query<WithContractAccess<Phase>>(
        ctx.sql`
            SELECT *,
                   ${hasContractAccess} AS "contractAccess"
            FROM ${PHASE_TABLE}
            WHERE "id" = ${phaseId}
          `
      );
      if (!phase) throw GraphQLError.notFound('phase');
      validateContractAccess(phase);

      const position = phase.order > moveTo ? '+ 1' : '- 1';
      const rangeStart = Math.min(phase.order, moveTo);
      const rangeEnd = Math.max(phase.order, moveTo);

      const { rows: updatedPhases } = await client.query<Pick<Phase, 'id'>>(
        ctx.sql`
            UPDATE ${PHASE_TABLE}
            SET "order" = "order" ${ctx.sql.raw(position)}
            WHERE "contractId" = ${phase.contractId}
              AND "order" BETWEEN ${rangeStart} AND ${rangeEnd}
            RETURNING "id"
          `
      );
      PhaseModel.UtilDataLoader.clear(updatedPhases, ctx);

      await PhaseModel.update.exec(
        client,
        {
          id: phaseId,
          order: moveTo
        },
        ctx
      );

      const contractPhases = await ContractModel.getPhases.exec(
        client,
        {
          contractId: phase.contractId
        },
        ctx
      );

      ctx.events.push(() => publishPhasesUpdated({ id: contractPhases[0].contractId }));

      return contractPhases;
    });

    await ctx.resolveEvents();

    return updatedPhases;
  }
);
