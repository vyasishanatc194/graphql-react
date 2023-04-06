import { defQuery } from '../../../index';
import { Contract, CONTRACT_TABLE, ContractStatus, ContractPermissionResult } from '../../../../db/types/contract';
import { ARCHIVE_CONTRACT_TABLE } from '../../../../db/types/archiveContract';

const ALLOWED_STATUSES = [ContractStatus.Hired, ContractStatus.Completed];

defQuery<Contract[], { forceFetchContractId?: string }>(
  'getManageContracts(forceFetchContractId: ID): [Contract!]! @authenticated',
  (_root, args, ctx) => {
    return ctx.db.getClient<Contract[]>(async client => {
      const currentRoleId = ctx.currentUser!.lastRoleId;

      const hasContractAccess = ctx.sql.contractAccess(ctx.sql.raw('contracts."id"'), currentRoleId);

      const condition = args.forceFetchContractId
        ? ctx.sql.raw(`OR contracts."id" = '${args.forceFetchContractId}'`)
        : ctx.sql.raw('');

      const { rows } = await client.query(
        ctx.sql`
          SELECT contracts.*
          FROM ${CONTRACT_TABLE} contracts
            LEFT JOIN ${ARCHIVE_CONTRACT_TABLE} archives
            ON (archives."contractId" = contracts."id" AND archives."roleId" = ${currentRoleId})
          WHERE contracts."status" = ANY(${ALLOWED_STATUSES})
            AND ${hasContractAccess} = ${ContractPermissionResult.Ok}
            AND (archives."id" IS NULL ${condition})
        `
      );

      return rows;
    });
  }
);
