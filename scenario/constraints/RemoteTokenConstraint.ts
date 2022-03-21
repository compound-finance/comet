import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { requireString, requireList } from './utils';

interface RemoteTokenConfig {
  network: string;
  address: string;
  args: any[];
}

function getRemoteTokenConfig(requirements: Requirements): RemoteTokenConfig | null {
  let remoteToken = requirements.remoteToken;
  if (!remoteToken) {
    return null;
  }
  return {
    network: requireString(remoteToken, 'network', 'network required in remote token config'),
    address: requireString(remoteToken, 'address', 'address required in remote token config'),
    args: remoteToken['args']
      ? requireList<any>(remoteToken, 'args', 'must be list if present')
      : [],
  };
}

export class RemoteTokenConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let parsedRequirements = getRemoteTokenConfig(requirements);
    if (parsedRequirements === null) {
      return null;
    }
    let { network, address, args } = parsedRequirements;

    return async (context: T) => {
      let buildFile = await context.deploymentManager.import(address, network);
      context.remoteToken = await context.deploymentManager.deployBuild(buildFile, args);
    };
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
