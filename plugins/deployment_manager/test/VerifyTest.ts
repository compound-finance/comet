import hre from 'hardhat';
import nock from 'nock';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import * as fs from 'fs';
import * as path from 'path';
import { verifyContract } from '../Verify';
import { deployBuild } from '../Deploy';
import { buildToken, faucetTokenBuildFile, tokenArgs } from './DeployHelpers';

export function mockVerifySuccess(hre: HardhatRuntimeEnvironment) {
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

  nock('https://solc-bin.ethereum.org/').get('/bin/list.json').reply(200, solcList);

  nock('https://api-goerli.etherscan.io/')
    .post('/api', /action=verifysourcecode/)
    .reply(200, {
      status: 1,
      message: 'OK',
      result: 'MYGUID',
    });

  nock('https://api-goerli.etherscan.io/')
    .get('/api')
    .query({
      apikey: 'GOERLI_KEY',
      module: 'contract',
      action: 'checkverifystatus',
      guid: 'MYGUID',
    })
    .reply(200, {
      status: 1,
      message: 'OK',
      result: 'Pass - Verified',
    });
}

describe('Verify', () => {
  beforeEach(async () => {
    nock.disableNetConnect();
  });

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
