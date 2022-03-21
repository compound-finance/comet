import { DeploymentManager, getNetwork } from '../../plugins/deployment_manager/DeploymentManager';
import { Contract, VoidSigner } from 'ethers';
import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { requireString, requireList } from './utils';
// import * as Mainnet from '../../src/deploy/mainnet/CloneTokens';
import { deployToken as deployMainnetToken } from '../../src/deploy/mainnet/CloneTokens';
import { clonePriceFeed as cloneMainnetPriceFeed } from '../../src/deploy/mainnet/ClonePriceFeeds';
// import { getPriceFeed } from '../../src/deploy';
import { upgradeComet } from './ModernConstraint';
import { exp, wait } from '../../test/helpers';

type DeployTokenFn = (
  name: string,
  deploymentManager: DeploymentManager,
  signerAddress: string
) => Promise<Contract>;

type DeployPriceFeedFn = (
  name: string,
  deploymentManager: DeploymentManager
) => Promise<Contract>;

const deployFunctions: {
  [network: string]: {
    deployTokenFn: DeployTokenFn,
    deployPriceFeedFn: DeployPriceFeedFn
  },
} = {
  mainnet: {
    deployTokenFn: deployMainnetToken,
    deployPriceFeedFn: cloneMainnetPriceFeed
  }
};

interface RemoteTokenConfig {
  [network: string]: string[];
}

function getRemoteTokenConfig(requirements: object): RemoteTokenConfig | null {
  let remoteToken = requirements['remote_token'] as RemoteTokenConfig;
  if (!remoteToken) {
    return null;
  }
  return remoteToken;
}

export class RemoteTokenConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    let parsedRequirements = getRemoteTokenConfig(requirements);
    if (parsedRequirements === null) {
      return null;
    }
    return async (context: T) => {
      let currentAssets = context.assets;
      let assetConfigs = await context.getAssetConfigs();

      for (let [network, tokens] of Object.entries(parsedRequirements)) {
        const { deployTokenFn, deployPriceFeedFn } = deployFunctions[network];
        if (typeof deployTokenFn !== 'function') {
          throw new Error(`Unknown network for remote token: ${network}`);
        }
        for (let symbol of tokens) {
          if (currentAssets[symbol]) {
            console.log(`Comet already registered ${symbol}`);
          } else {
            console.log(`Registered remote token ${network} ${symbol}`);
            let token = await deployTokenFn(symbol, context.deploymentManager, context.primaryActor().address);
            let decimals = await token.decimals();

            const priceFeed = await deployPriceFeedFn(symbol, context.deploymentManager); // add configuration options to set price?

            assetConfigs.push({
              asset: token.address,
              priceFeed: priceFeed.address,
              decimals,
              borrowCollateralFactor: exp(1, 18),
              liquidateCollateralFactor: exp(1, 18),
              liquidationFactor: exp(1, 18),
              supplyCap: exp(1000, decimals)
            });
          }
        }

        await upgradeComet(context, world, { assetConfigs });
      }
    };
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}
