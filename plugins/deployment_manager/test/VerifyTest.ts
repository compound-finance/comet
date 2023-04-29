import hre from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import * as fs from 'fs';
import * as path from 'path';
import { verifyContract } from '../Verify';
import { deployBuild } from '../Deploy';
import { buildToken, faucetTokenBuildFile, tokenArgs } from './DeployHelpers';
import { MockAgent, setGlobalDispatcher } from 'undici';

export function mockVerifySuccess(hre: HardhatRuntimeEnvironment) {
  // We use undici's intercepter to mock the HTTP requests because the Hardhat Etherscan plugin now uses
  // undici instead of node-fetch
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  let solcList = JSON.parse(fs.readFileSync(path.join(__dirname, './SolcList.json'), 'utf8'));

  // Note: we need to convince the prober task that this is goerli, which it's not.
  // So we'll fake the network name and the chain ID
  hre.config.etherscan.apiKey = {
    goerli: 'GOERLI_KEY',
  };
  hre.network.name = 'goerli';
  let sendOld = hre.network.provider.send.bind(hre.network.provider);
  hre.network.provider.send = function (...args) {
    if (args.length === 1 && args[0] === 'eth_chainId') {
      return Promise.resolve(5);
    } else {
      return sendOld(...args);
    }
  };

  const solcMockPool = mockAgent.get('https://solc-bin.ethereum.org');
  const etherscanMockPool = mockAgent.get('https://api-goerli.etherscan.io');

  solcMockPool.intercept({
    path: '/bin/list.json',
    method: 'GET'
  }).reply(200, solcList);

  etherscanMockPool.intercept({
    path: '/api',
    method: 'POST',
    body: /action=verifysourcecode/
  }).reply(200, {
    status: 1,
    message: 'OK',
    result: 'MYGUID',
  });

  etherscanMockPool.intercept({
    path: '/api',
    method: 'GET',
    query: {
      apikey: 'GOERLI_KEY',
      module: 'contract',
      action: 'checkverifystatus',
      guid: 'MYGUID',
    }
  }).reply(200, {
    status: 1,
    message: 'OK',
    result: 'Pass - Verified',
  });

  // Hardhat Etherscan now checks to see if a contract is already verified before verifying it
  etherscanMockPool.intercept({
    path: /api\?action=getsourcecode.*/,
    method: 'GET',
  }).reply(200, {
    status: 1,
    message: 'OK',
    result: 'Source code not found',
  });
}

describe('Verify', () => {
  describe('via artifacts', () => {
    it('verify from artifacts [success]', async () => {
      mockVerifySuccess(hre);
      let token = await buildToken();
      await verifyContract(
        { via: 'artifacts', address: token.address, constructorArguments: tokenArgs },
        hre,
        true
      );
    });
  });

  describe('via buildfile', () => {
    it('verify from build file', async () => {
      mockVerifySuccess(hre);
      let contract = await deployBuild(faucetTokenBuildFile, tokenArgs, hre, { network: 'test-network' });
      await verifyContract(
        { via: 'buildfile', contract, buildFile: faucetTokenBuildFile, deployArgs: tokenArgs },
        hre,
        true
      );
    });
  });
});
