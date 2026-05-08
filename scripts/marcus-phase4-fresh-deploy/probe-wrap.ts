// Probe wrap_gas_to_spl to fund the deployer's UnifiedToken balance.
// We send actual signed tx (not eth_call) since the dry-run was getting
// a misleading "tx.value must be multiple of 10^12" error even with value=0.

import { ethers } from 'hardhat';

const WRAP_PRECOMPILE = '0x4200000000000000000000000000000000000018';
const WRAP_SELECTOR = '0x79a25e80'; // wrap_gas_to_spl(uint256)
const UNIFIED_TOKEN = '0xda16E38514eD2Fa5E6587028Efc22226deC97f7a';
const WUSDC = '0x39844f1d605a11acd87f766494291bbd11b406f4'; // SPL_ERC20_USDC wrapper from registry

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Caller: ${signer.address}`);

  // Try wrap of 1 USDC = 1e18 wei (which IS a multiple of 1e12)
  const amount = ethers.utils.parseUnits('1', 18);
  console.log(`Wrap amount: ${amount} wei (= ${ethers.utils.formatEther(amount)} gas USDC)`);

  const data = WRAP_SELECTOR + amount.toHexString().slice(2).padStart(64, '0');
  console.log(`Calldata:    ${data}`);

  // First check ATA exists by reading wUSDC.balanceOf(signer)
  const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
  const wusdc = new ethers.Contract(WUSDC, erc20Abi, signer);
  const wusdcBal = await wusdc.balanceOf(signer.address);
  console.log(`Pre  wUSDC.balanceOf(deployer): ${wusdcBal}`);
  const ut = new ethers.Contract(UNIFIED_TOKEN, erc20Abi, signer);
  const utBal = await ut.balanceOf(signer.address);
  console.log(`Pre  UnifiedToken.balanceOf(deployer): ${utBal}`);

  console.log(`\nSending tx…`);
  try {
    const tx = await signer.sendTransaction({
      to: WRAP_PRECOMPILE,
      data,
      gasLimit: 30_000_000,
    });
    console.log(`tx hash: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`status: ${rcpt.status}, gasUsed: ${rcpt.gasUsed}`);
  } catch (e: any) {
    console.log(`REVERT: ${e.message?.slice(0, 300) ?? e}`);
    if (e.data) console.log(`error data: ${e.data}`);
    if (e.error?.body) console.log(`error body: ${e.error.body}`);
    return;
  }

  const wusdcBal2 = await wusdc.balanceOf(signer.address);
  const utBal2 = await ut.balanceOf(signer.address);
  console.log(`\nPost wUSDC.balanceOf(deployer): ${wusdcBal2}`);
  console.log(`Post UnifiedToken.balanceOf(deployer): ${utBal2}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
