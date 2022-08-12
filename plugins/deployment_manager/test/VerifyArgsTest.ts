import hre from 'hardhat';
import { expect } from 'chai';
import { Cache } from '../Cache';
import { objectFromMap } from '../Utils';
import * as os from 'os';
import { deleteVerifyArgs, getVerifyArgs, putVerifyArgs } from '../VerifyArgs';
import { VerifyArgs } from '../Verify';
import { deploy, faucetTokenBuildFile } from './DeployHelpers';

describe('VerifyArgs', () => {
  it('gets, sets, and deletes verify args', async () => {
    const cache = new Cache('test-network', 'test-deployment', false, os.tmpdir());

    const testContract = await deploy(
      'test/Dog.sol',
      ['spot', '0x0000000000000000000000000000000000000001', []],
      hre,
      { cache, network: 'test-network' }
    );
    const verifyArgs1: VerifyArgs = { via: 'artifacts', address: '0x0000000000000000000000000000000000000000', constructorArguments: [] };
    const verifyArgs2: VerifyArgs = { via: 'buildfile', contract: testContract, buildFile: faucetTokenBuildFile, deployArgs: [] };

    expect(objectFromMap(await getVerifyArgs(cache))).to.eql({});
    await putVerifyArgs(cache, '0x0000000000000000000000000000000000000000', verifyArgs1);
    expect(objectFromMap(await getVerifyArgs(cache))).to.eql({
      '0x0000000000000000000000000000000000000000': verifyArgs1,
    });
    await putVerifyArgs(cache, '0x0000000000000000000000000000000000000000', verifyArgs2);
    await putVerifyArgs(cache, '0x0000000000000000000000000000000000000001', verifyArgs2);
    expect(objectFromMap(await getVerifyArgs(cache))).to.eql({
      '0x0000000000000000000000000000000000000000': verifyArgs2,
      '0x0000000000000000000000000000000000000001': verifyArgs2,
    });
    await deleteVerifyArgs(cache, '0x0000000000000000000000000000000000000000');
    expect(objectFromMap(await getVerifyArgs(cache))).to.eql({
      '0x0000000000000000000000000000000000000001': verifyArgs2,
    });
  });
});
