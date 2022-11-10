import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  CometInterface,
  Liquidator
} from '../../build/types';
import {
  arbitragePurchaseableCollateral,
  liquidateUnderwaterBorrowers,
  getAssets,
  Asset
} from './liquidateUnderwaterBorrowers';
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { providers, Wallet } from 'ethers';

const loopDelay = 5000;
const loopsUntilUpdateAssets = 1000;
let assets: Asset[] = [];

async function main() {
  let { DEPLOYMENT: deployment, LIQUIDATOR_ADDRESS: liquidatorAddress, USE_FLASHBOTS: useFlashbots } = process.env;
  if (!liquidatorAddress) {
    throw new Error('missing required env variable: LIQUIDATOR_ADDRESS');
  }
  if (!deployment) {
    throw new Error('missing required env variable: DEPLOYMENT');
  }

  const network = hre.network.name;

  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: false,
      verificationStrategy: 'eager',
    }
  );
  await dm.spider();

  const signer = await dm.getSigner();
  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  // Flashbots provider requires passing in a standard provider
  let flashbotsProvider: FlashbotsBundleProvider;
  if (useFlashbots.toLowerCase() === 'true') {
    // XXX use a designated auth signer
    // `authSigner` is an Ethereum private key that does NOT store funds and is NOT your bot's primary key.
    // This is an identifying key for signing payloads to establish reputation and whitelisting
    // In production, this should be used across multiple bundles to build relationship. In this example, we generate a new wallet each time
    const authSigner = Wallet.createRandom();

    if (network === 'mainnet') {
      flashbotsProvider = await FlashbotsBundleProvider.create(
        signer.provider! as providers.BaseProvider, // a normal ethers.js provider, to perform gas estimations and nonce lookups
        authSigner, // ethers.js signer wallet, only for signing request payloads, not transactions
      );
    } else if (network === 'goerli') {
      flashbotsProvider = await FlashbotsBundleProvider.create(
        signer.provider! as providers.BaseProvider, // a normal ethers.js provider, to perform gas estimations and nonce lookups
        authSigner, // ethers.js signer wallet, only for signing request payloads, not transactions
        'https://relay-goerli.flashbots.net',
        'goerli'
      );
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }
  }

  const signerWithFlashbots = { signer, flashbotsProvider };

  if (!comet) {
    throw new Error(`no deployed Comet found for ${network}/${deployment}`);
  }

  const liquidator = await hre.ethers.getContractAt(
    'Liquidator',
    liquidatorAddress,
    signer
  ) as Liquidator;

  let lastBlockNumber: number;
  let loops = 0;
  while (true) {
    if (loops >= loopsUntilUpdateAssets) {
      console.log('Updating assets');
      assets = await getAssets(comet);
      loops = 0;
    }

    const currentBlockNumber = await hre.ethers.provider.getBlockNumber();

    console.log(`currentBlockNumber: ${currentBlockNumber}`);

    if (currentBlockNumber !== lastBlockNumber) {
      lastBlockNumber = currentBlockNumber;
      const liquidationAttempted = await liquidateUnderwaterBorrowers(
        comet,
        liquidator,
        signerWithFlashbots
      );
      if (!liquidationAttempted) {
        await arbitragePurchaseableCollateral(
          comet,
          liquidator,
          assets,
          signerWithFlashbots
        );
      }
    } else {
      console.log(`block already checked; waiting ${loopDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, loopDelay));
    }

    loops += 1;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
