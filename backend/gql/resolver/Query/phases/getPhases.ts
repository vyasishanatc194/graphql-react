/*external modules*/
import _ from 'lodash';
/*DB*/
import { Phase } from '../../../../db/types/phase';
import { CollaboratorPermission } from '../../../../db/types/collaborator';
/*models*/
import { ContractModel } from '../../../../db/models/ContractModel';
/*GQL*/
import { defQuery, GraphQLError } from '../../../index';
/*other*/
import { validateContractAccess, WithContractAccess } from '../../../checks/validateContractAccess';

type TArgs = { contractId: string };
type TReturn = Phase[];

defQuery<TReturn, TArgs>(`getPhases(contractId: ID!): [Phase!]! @authenticated`, (_root, args, ctx) => {
  return ctx.db.getClient<Phase[]>(async client => {
    const hasContractAccess = ctx.sql.contractAccess(args.contractId, ctx.currentUser!.lastRoleId, {
      minPermission: CollaboratorPermission.Write
    });

    const {
      rows: [contractAccess]
    } = await client.query<WithContractAccess>(ctx.sql`SELECT ${hasContractAccess} as "contractAccess"`);
    if (!contractAccess) throw GraphQLError.notFound('contract');
    validateContractAccess(contractAccess);

    const phases = await ContractModel.getPhases.exec(
      client,
      {
        contractId: args.contractId
      },
      ctx
    );

    return _.orderBy(phases, 'order', 'asc');
  });
});
