import { defSubscription, pubsub } from '../../../index';
import { Contract } from '../../../../db/types/contract';
import { contractsUpdatedTopic } from '../../../../notifications/subscriptions/contracts/updated';

defSubscription<{}, { contractId: string }, Contract>(
  `contractsUpdated: Contract! @authenticated`,
  (_root, _args, ctx) => {
    const topic = contractsUpdatedTopic(ctx.currentUser!.lastRoleId);
    return pubsub.asyncIterator(topic);
  },
  ({ contractId }, _args, ctx) => {
    ctx.dataLoader.flush();
    return ctx.dataLoader('contracts').loadStrict(contractId);
  }
);
