import {
  Deployed,
  DeploymentManager
} from '../../../plugins/deployment_manager';
import { FaucetToken, SimplePriceFeed } from '../../../build/types';
import {
  DeploySpec,
  cloneGov,
  deployComet,
  exp,
  sameAddress,
  wait
} from '../../../src/deploy';

async function makeToken(
  deploymentManager: DeploymentManager,
  amount: number,
  name: string,
  decimals: number,
  symbol: string
): Promise<FaucetToken> {
  const mint = (BigInt(amount) * 10n ** BigInt(decimals)).toString();
  return deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [
    mint,
    name,
    decimals,
    symbol
  ]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  alias: string,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [
    initialPrice * 1e8,
    decimals
  ]);
}

// TODO: Support configurable assets as well?
export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Deploy governance contracts
  const { fauceteer, governor, timelock } = await cloneGov(deploymentManager);

  const USDT = await makeToken(deploymentManager, 10000000, 'USDT', 18, 'USDT');
  const COMP = await makeToken(deploymentManager, 20000000, 'COMP', 8, 'COMP');
  const WETH = await makeToken(deploymentManager, 30000000, 'WETH', 10, 'WETH');

  const usdtPriceFeed = await makePriceFeed(
    deploymentManager,
    'USDT:priceFeed',
    1,
    8
  );
  const compPriceFeed = await makePriceFeed(
    deploymentManager,
    'COMP:priceFeed',
    0.5,
    8
  );
  const wethPriceFeed = await makePriceFeed(
    deploymentManager,
    'WETH:priceFeed',
    0.05,
    8
  );

  const assetConfig0 = {
    asset: COMP.address,
    priceFeed: compPriceFeed.address,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.65e18).toString(),
    liquidateCollateralFactor: (0.7e18).toString(),
    liquidationFactor: (0.93e18).toString(),
    supplyCap: (10000000e8).toString()
  };

  const assetConfig1 = {
    asset: WETH.address,
    priceFeed: wethPriceFeed.address,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.825e18).toString(),
    liquidateCollateralFactor: (0.895e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (10000000e8).toString()
  };

  // Deploy all Comet-related contracts
  let rewards;
  try {
    const deployed = await deployComet(deploymentManager, deploySpec, {
      baseTokenPriceFeed: usdtPriceFeed.address,
      assetConfigs: [assetConfig0, assetConfig1]
    });
    rewards = deployed.rewards;
  } catch (e) {
    console.error(e);
    return;
  }

  await deploymentManager.idempotent(
    async () => (await COMP.balanceOf(rewards.address)).eq(0),
    async () => {
      trace(`Sending some COMP to CometRewards`);
      const amount = exp(2_000_000, 8);
      trace(await wait(COMP.connect(signer).transfer(rewards.address, amount)));
      trace(
        `COMP.balanceOf(${rewards.address}): ${await COMP.balanceOf(
          rewards.address
        )}`
      );
    }
  );

  // Mint some tokens
  trace(`Attempting to mint as ${signer.address}...`);

  await Promise.all(
    [
      [USDT, 1e8],
      [COMP, 2e6],
      [WETH, 1e7]
    ].map(([asset, units]) => {
      return deploymentManager.idempotent(
        async () => (await asset.balanceOf(fauceteer.address)).eq(0),
        async () => {
          trace(`Minting ${units} ${await asset.symbol()} to fauceteer`);
          const amount = exp(units, await asset.decimals());
          trace(
            await wait(
              asset.connect(signer).allocateTo(fauceteer.address, amount)
            )
          );
          trace(
            `asset.balanceOf(${signer.address}): ${await asset.balanceOf(
              signer.address
            )}`
          );
        }
      );
    })
  );

  return { ...deployed, fauceteer };
}
