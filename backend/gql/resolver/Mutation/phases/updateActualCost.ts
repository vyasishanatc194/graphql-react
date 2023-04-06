/*external modules*/
/*DB*/
import { Phase, PHASE_TABLE } from '../../../../db/types/phase';
import { UserRole } from '../../../../db/types/role';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
/*models*/
import { PhaseModel } from '../../../../db/models/PhaseModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../../index';
import { PhaseCostInput } from '../../PhaseCostInput';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

type TArgs = { phaseId: string; cost: PhaseCostInput };
type TReturn = Phase;

defMutation<TReturn, TArgs>(
  `updateActualPhaseCost(
    phaseId: ID!,
    cost: PhaseCostInput!
  ): Phase! @authenticated @contractPaid(path: "phaseId")`,
  (_root, { phaseId, cost }, ctx) => {
    return ctx.db.getClient<Phase>(async client => {
      const hasContractAccess = ctx.sql.contractAccess(ctx.sql.raw('"contractId"'), ctx.currentUser!.lastRoleId, {
        minPermission: CollaboratorPermission.Full,
        role: UserRole.Pro
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

      const updatedPhase = await PhaseModel.update.exec(
        client,
        {
          id: phaseId,
          actualMaterialCost: cost.material,
          actualLaborCost: cost.labor,
          actualOtherCost: cost.other
        },
        ctx
      );
      if (!updatedPhase) throw new GraphQLError('phase not updated');

      return updatedPhase;
    });
  }
);
