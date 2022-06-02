import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { exp, wait } from '../../../test/helpers';

interface Vars {};

migration<Vars>('1653357106_mint_to_fauceteer', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const signer = await deploymentManager.getSigner();
    const signerAddress = signer.address;

    console.log(`Minting as signer: ${signerAddress}`);

    const contracts = await deploymentManager.contracts();
    const timelock = contracts.get('timelock');
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
    const WBTC = contracts.get('WBTC');
    const wbtcDecimals = await WBTC.decimals();
    console.log(`minting WBTC@${WBTC.address} to fauceteer${fauceteerAddress}`);
    await wait(WBTC.mint(fauceteerAddress, exp(100_000_000, wbtcDecimals))); // mint 100M WBTC
    console.log(`WBTC.balanceOf(fauceteerAddress): ${await WBTC.balanceOf(fauceteerAddress)}`);

    // COMP
    const COMP = contracts.get('COMP');
    const signerCompBalance = await COMP.balanceOf(signerAddress);

    console.log(`transferring ${signerCompBalance.div(2)} COMP@${COMP.address} to fauceteer@${fauceteerAddress}`);
    await COMP.transfer(fauceteerAddress, signerCompBalance.div(2)); // transfer half of signer's balance
    console.log(`COMP.balanceOf(fauceteerAddress): ${await COMP.balanceOf(fauceteerAddress)}`);

    console.log(`transferring ${signerCompBalance.div(2)} COMP@${COMP.address} to timelock@${timelock.address}`);
    await COMP.transfer(timelock.address, signerCompBalance.div(2)); // transfer half of signer's balance
    console.log(`COMP.balanceOf(timelock.address): ${await COMP.balanceOf(timelock.address)}`);

    // UNI
    const UNI = contracts.get('UNI');
    const uniTotalSupply = await UNI.totalSupply();
    console.log(`minting UNI@${UNI.address} to fauceteer@${fauceteerAddress}`);
    await UNI.mint(fauceteerAddress, uniTotalSupply.div(1e2)); // mint 1% of total supply (UNI contract only allows minting 2% of total supply)
    console.log(`UNI.balanceOf(fauceteerAddress): ${await UNI.balanceOf(fauceteerAddress)}`);

    // LINK
    const LINK = contracts.get('LINK');
    const signerLinkBalance = await LINK.balanceOf(signerAddress);
    console.log(`transferring ${signerLinkBalance.div(2)} LINK@${LINK.address} to fauceteer@${fauceteerAddress}`);
    await LINK.transfer(fauceteerAddress, signerLinkBalance.div(2)); // transfer half of signer's balance
    console.log(`LINK.balanceOf(fauceteerAddress): ${await LINK.balanceOf(fauceteerAddress)}`);

    return {};
  },
  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return true; // XXX cannot be run independently
  },
});
