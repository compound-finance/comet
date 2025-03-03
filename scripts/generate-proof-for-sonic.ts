import hre from 'hardhat';
import { ethers } from 'ethers';
import 'dotenv/config';

// Ethereum (L1)
const ETH_CONTRACTS = {
  TOKEN_DEPOSIT: '0xa1E2481a9CD0Cb0447EeB1cbc26F1b3fff3bec20',
  TOKEN_PAIRS: '0xf2b1510c2709072C88C5b14db90Ec3b6297193e4',
  STATE_ORACLE: '0xB7e8CC3F5FeA12443136f0cc13D81F109B2dEd7f'
};

// Sonic (L2)
const SONIC_CONTRACTS = {
  BRIDGE: '0x9Ef7629F9B930168b76283AdD7120777b3c895b3',
  TOKEN_PAIRS: '0x134E4c207aD5A13549DE1eBF8D43c1f49b00ba94',
  STATE_ORACLE: '0x836664B0c0CB29B7877bCcF94159CC996528F2C3'
};

const depositId = '73349807872669471758776011431628219605093298554399434512056825181054703893822';

async function main() {
  // Network RPC endpoints
  const { ANKR_KEY } = process.env;
  const ETHEREUM_RPC = `https://rpc.ankr.com/eth/${ANKR_KEY}`;
  const SONIC_RPC = 'https://rpc.soniclabs.com';

  // Initialize providers
  const ethProvider = new hre.ethers.providers.JsonRpcProvider(ETHEREUM_RPC);
  const sonicProvider = new hre.ethers.providers.JsonRpcProvider(SONIC_RPC);

  console.log('proof:', await generateProof(depositId, ethProvider, sonicProvider));
}
async function generateProof(depositId: string, ethProvider: ethers.providers.JsonRpcProvider, sonicProvider: ethers.providers.Provider | ethers.Signer) {
  // Generate storage slot for deposit
  const storageSlot = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['uint256', 'uint8'], [depositId, 7])
  );
    
  // Get proof from Ethereum node  
  const stateOracle = new ethers.Contract(
    SONIC_CONTRACTS.STATE_ORACLE,
    [
      'function lastBlockNum() view returns(uint256)',
    ],
    sonicProvider
  );

  const blockNum = await stateOracle.lastBlockNum();
  const block = await ethProvider.send('eth_getBlockByNumber', [blockNum, false]);
  const proof = await ethProvider.send('eth_getProof', [
    ETH_CONTRACTS.TOKEN_DEPOSIT,
    [storageSlot],
    block.hash
  ]);
  const result = ethers.utils.RLP.encode([
    ethers.utils.RLP.encode(proof.accountProof),
    ethers.utils.RLP.encode(proof.storageProof[0].proof)
  ]);
  
  return result;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
