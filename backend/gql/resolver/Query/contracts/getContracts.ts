/*external modules*/
/*DB*/
import { sql } from '../../../../db';
import { Contract, CONTRACT_TABLE, ContractPermissionResult } from '../../../../db/types/contract';
import { ARCHIVE_CONTRACT_TABLE } from '../../../../db/types/archiveContract';
/*models*/
/*GQL*/
import { defQuery } from '../../../index';
/*other*/

defQuery<Contract[], { archived?: boolean }>(
  `getContracts(archived: Boolean): [Contract!]! @authenticated`,
  async (_root, args, ctx) => {
    const currentRoleId = ctx.currentUser!.lastRoleId;

    const hasContractAccess = ctx.sql.contractAccess(ctx.sql.raw('contracts."id"'), currentRoleId);

    const condition = args.archived ? sql.raw(`archives."id" IS NOT NULL`) : sql.raw(`archives."id" IS NULL`);

    const { rows: contracts } = await ctx.db.pool.query<Contract>(
      ctx.sql`
        SELECT contracts.*
        FROM ${CONTRACT_TABLE} contracts
            LEFT JOIN ${ARCHIVE_CONTRACT_TABLE} archives
            ON (archives."contractId" = contracts."id" AND archives."roleId" = ${currentRoleId})
        WHERE ${hasContractAccess} = ${ContractPermissionResult.Ok}
          AND ${condition}
      `
    );

    return contracts;
  }
);
