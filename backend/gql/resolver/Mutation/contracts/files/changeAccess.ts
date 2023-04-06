/*external modules*/
import _ from 'lodash';
/*DB*/
import { File, FILE_TABLE } from '../../../../../db/types/file';
import { Role, UserRole } from '../../../../../db/types/role';
import { CollaboratorPermission } from '../../../../../db/types/collaborator';
import { Contract, CONTRACT_TABLE } from '../../../../../db/types/contract';
/*models*/
import { FileModel } from '../../../../../db/models/FileModel';
import { CollaboratorModel } from '../../../../../db/models/CollaboratorModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../../..';
import { validateContractAccess, WithContractAccess } from '../../../../checks/validateContractAccess';
/*other*/
import { TFunction } from '@beyrep/types';

type TArgs = {
  contractId: Contract['id'];
  files: Array<File['id']>;
  addAssignees: Array<Role['id']>;
  removeAssignees: Array<Role['id']>;
};
type TReturn = File[];

defMutation<TReturn, TArgs>(
  `changeAccessToContractFiles(
      contractId: ID!,
      files: [ID!]!,
      addAssignees: [ID!]!,
      removeAssignees: [ID!]!
    ): [File!]! @authenticated`,
  async (_root, args, ctx) => {
    const files = await ctx.db.getClientTransaction(async client => changeAccessToContractFiles(client, args, ctx));

    await ctx.resolveEvents();

    return files;
  }
);

export const changeAccessToContractFiles: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentUserRoleId = ctx.currentUser!.lastRoleId;
  const { contractId, files, addAssignees, removeAssignees } = args;

  const hasContractAccess = ctx.sql.contractAccess(contractId, currentUserRoleId!, {
    minPermission: CollaboratorPermission.Full,
    role: UserRole.Pro,
    checkContractEnded: true
  });

  const {
    rows: [contract]
  } = await client.query<WithContractAccess<Contract & { contractFiles: Array<File['id']> }>>(
    ctx.sql`
      SELECT contracts.*,
             array_agg(files."id") AS "contractFiles",
             ${hasContractAccess} AS "contractAccess"
      FROM ${CONTRACT_TABLE} contracts
        INNER JOIN ${FILE_TABLE} files
          ON files."contractId" = contracts."id"
          AND files."id" = ANY(${files})
      WHERE contracts."id" = ${contractId}
      GROUP BY contracts."id"
    `
  );
  if (!contract) throw GraphQLError.notFound('contract');
  validateContractAccess(contract);

  const filesDiff = _.difference(files, contract.contractFiles);
  if (!_.isEmpty(filesDiff)) {
    throw new GraphQLError(`Some passed files not belong to the Contract`);
  }

  await Promise.all(
    _.map([...addAssignees, ...removeAssignees], async collaboratorId => {
      const collaborator = await CollaboratorModel.findById.exec(
        client,
        {
          collaboratorId
        },
        ctx
      );
      if (!collaborator) throw GraphQLError.notFound('collaborator');

      if (collaborator.contractId !== contractId) {
        throw new GraphQLError(`Collaborator not belong to the Contract`);
      }
    })
  );

  if (!_.isEmpty(addAssignees)) {
    await Promise.all(
      _.map(files, fileId =>
        FileModel.addAssignees.exec(
          client,
          {
            fileId,
            assignees: addAssignees
          },
          ctx
        )
      )
    );
  }

  if (!_.isEmpty(removeAssignees)) {
    await Promise.all(
      _.map(files, fileId =>
        FileModel.removeAssignees.exec(
          client,
          {
            fileId,
            assignees: removeAssignees
          },
          ctx
        )
      )
    );
  }

  return FileModel.findMany.exec(
    client,
    {
      files
    },
    ctx
  );
};
