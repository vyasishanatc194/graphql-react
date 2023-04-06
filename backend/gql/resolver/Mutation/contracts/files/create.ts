/*external modules*/
import _ from 'lodash';
/*DB*/
import { CONTRACT_TABLE } from '../../../../../db/types/contract';
import { File, FILE_TABLE } from '../../../../../db/types/file';
import { CollaboratorPermission } from '../../../../../db/types/collaborator';
import { ContractActivityType } from '../../../../../db/types/contractActivity';
/*models*/
import { FileModel } from '../../../../../db/models/FileModel';
/*GQL*/
import { defMutation, GraphQLError } from '../../../../index';
import { WhoCanSeeFiles } from '../../../Types/File';
/*other*/
import { TFunction } from '@beyrep/types';
import jobWorker from '../../../../../jobs';
import { validateContractAccess, WithContractAccess } from '../../../../checks/validateContractAccess';
import { publishFileUpdated } from '../../../../../notifications/subscriptions/files/updated';

type TArgs = {
  files: string[];
  contractId: string;
  whoCanSeeFiles: WhoCanSeeFiles;
};
type TReturn = File[];

defMutation<TReturn, TArgs>(
  `createContractFiles(
    files: [ID!]!,
    contractId: ID!,
    whoCanSeeFiles: WhoCanSeeFiles = All
  ): [File!]! @authenticated @contractPaid(path: "contractId")`,
  async (_root, args, ctx) => {
    const newFiles = await ctx.db.getClientTransaction(client => createContractFiles(client, args, ctx));

    await ctx.resolveEvents();

    return newFiles;
  }
);

export const createContractFiles: TFunction.GraphqlClientBasedResolver.ReturnRequired<TArgs, TReturn> = async (
  client,
  args,
  ctx
) => {
  const currentUserRoleId = ctx.currentUser!.lastRoleId;
  const { contractId, files, whoCanSeeFiles } = args;

  const hasContractAccess = ctx.sql.contractAccess(args.contractId, currentUserRoleId, {
    minPermission: CollaboratorPermission.Write,
    checkContractEnded: true
  });

  const {
    rows: [contractAccess]
  } = await client.query<WithContractAccess>(
    ctx.sql`
      SELECT ${hasContractAccess} AS "contractAccess"
      FROM ${CONTRACT_TABLE}
      WHERE "id" = ${contractId}
    `
  );
  if (!contractAccess) throw GraphQLError.notFound('contract');
  validateContractAccess(contractAccess);

  const { rows: updatedFiles } = await client.query<File>(
    ctx.sql`
      UPDATE ${FILE_TABLE}
      SET "contractId" = ${contractId}
      WHERE "id" = ANY(${files}::UUID[])
        AND "roleId" = ${currentUserRoleId}
      RETURNING *
    `
  );

  await FileModel.resolveWhoCanSeeFilesAction.exec(
    client,
    {
      whoCanSee: whoCanSeeFiles,
      files: _.map(updatedFiles, 'id'),
      contractId,
      collaborators: [],
      addCurrentUserIfCollaborator: true
    },
    ctx
  );

  _.forEach(updatedFiles, file => {
    ctx.events.push(() =>
      jobWorker.getQueue('create-contract-activity').add({
        type: ContractActivityType.FileNew,
        roleId: currentUserRoleId,
        contractId: args.contractId,
        fileId: file.id,
        fileName: file.name,
        fileMime: file.mime
      })
    );

    ctx.events.push(() => publishFileUpdated(file));

    ctx.events.push(() => jobWorker.getQueue('file-created').add({ fileId: file.id }));
  });

  return updatedFiles;
};
