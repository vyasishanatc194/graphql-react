/*external modules*/
/*DB*/
import { Contract, CONTRACT_TABLE } from '../../../../db/types/contract';
import { Project, PROJECT_TABLE } from '../../../../db/types/project';
import { Role, ROLE_TABLE, UserRole } from '../../../../db/types/role';
import { COLLABORATOR_TABLE, CollaboratorPermission } from '../../../../db/types/collaborator';
import { getPermissions } from '../../../../db/dataUtils/getPermissions';
/*models*/
import { RoleModel } from '../../../../db/models/RoleModel';
/*GQL*/
import { defQuery, GraphQLError } from '../../../index';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

type TArgs = {
  contractId: string;
  role?: UserRole;
  permissions?: CollaboratorPermission;
};
type TReturn = Role[];

defQuery<TReturn, TArgs>(
  `getContractUsers(
    contractId: ID!,
    role: UserRole,
    permissions: CollaboratorPermission
  ): [Role!]! @authenticated`,
  (_root, { contractId, role, permissions }, ctx) => {
    return ctx.db.getClient<Role[]>(async client => {
      const hasContractAccess = ctx.sql.contractAccess(contractId, ctx.currentUser!.lastRoleId, {
        minPermission: CollaboratorPermission.Read
      });

      const {
        rows: [contract]
      } = await client.query<
        WithContractAccess<
          Contract & {
            project: Project;
            owner?: Role;
            partner: Role;
          }
        >
      >(
        ctx.sql`
          SELECT ct.*,
                 row_to_json(pt.*) AS "project",
                 row_to_json(prt.*) AS "partner",
                 row_to_json(ort.*) AS "owner",
                 ${hasContractAccess} as "contractAccess"
          FROM ${CONTRACT_TABLE} AS ct
            INNER JOIN ${ROLE_TABLE} AS prt ON (prt."id" = ct."partnerId")
            INNER JOIN ${PROJECT_TABLE} AS pt ON (pt."id" = ct."projectId")
            LEFT JOIN ${ROLE_TABLE} AS ort ON (ort."id" = pt."ownerId")
          WHERE ct."id" = ${contractId}
        `
      );
      if (!contract) throw GraphQLError.notFound('contract');
      validateContractAccess(contract);

      if (contract.owner) RoleModel.UtilDataLoader.prime([contract.owner], ctx);
      if (contract.partner) RoleModel.UtilDataLoader.prime([contract.partner], ctx);

      const roleClause = role ? ctx.sql`AND rt."name" = ${role}` : ctx.sql.raw('');
      const permissionsClause = permissions
        ? ctx.sql`AND cot."permissions" = ANY(${getPermissions(permissions)})`
        : ctx.sql.raw('');
      const { rows: collaborators } = await client.query<Role>(
        ctx.sql`
          SELECT rt.*
          FROM ${COLLABORATOR_TABLE} AS cot
            INNER JOIN ${ROLE_TABLE} AS rt ON (rt."id" = cot."roleId")
          WHERE cot."contractId" = ${contractId} ${roleClause} ${permissionsClause}
        `
      );
      RoleModel.UtilDataLoader.prime(collaborators, ctx);

      const contractUsers: Role[] = [];

      switch (role) {
        case UserRole.HomeOwner:
          contract.owner && contractUsers.push(contract.owner);
          break;
        case UserRole.Pro:
          contractUsers.push(contract.partner);
          break;
        default:
          contractUsers.push(contract.partner);
          contract.owner && contractUsers.push(contract.owner);
      }

      return contractUsers.concat(collaborators);
    });
  }
);
