import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { exp, wait } from '../../../test/helpers';

interface Vars {};

migration<Vars>('1653431603_mint_to_fauceteer', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const [signer] = await deploymentManager.hre.ethers.getSigners();
    const signerAddress = await signer.getAddress();

    console.log(`Minting as signer: ${signerAddress}`);

    const contracts = await deploymentManager.contracts();
    const fauceteer = contracts.get('fauceteer');
    const fauceteerAddress = fauceteer.address;

    // USDC
    const USDC = contracts.get('USDC');
    const usdcDecimals = await USDC.decimals();
    console.log(`minting USDC@${USDC.address} to fauceteer@${fauceteerAddress}`);
    await wait(USDC.configureMinter(signerAddress, exp(100_000_000, usdcDecimals))); // mint 100M USDC
    await wait(USDC.mint(fauceteerAddress, exp(100_000_000, usdcDecimals)));
    console.log(`USDC.balanceOf(fauceteerAddress): ${await USDC.balanceOf(fauceteerAddress)}`);

    // WBTC
    const WBTC = contracts.get('WBTC.e');
    const wbtcDecimals = await WBTC.decimals();
    console.log(`minting WBTC@${WBTC.address} to fauceteer@${fauceteerAddress}`);
    await wait(
      WBTC.mint(
        fauceteer.address,
        exp(100_000_000, wbtcDecimals), // mint 100M WBTC
        '0x0000000000000000000000000000000000000000',
        0,
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    );
    console.log(`WBTC.balanceOf(fauceteerAddress): ${await WBTC.balanceOf(fauceteerAddress)}`);

    return {};
  },
  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {

  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false;
  },
});
