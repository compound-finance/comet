import hre from 'hardhat';
import { expect } from 'chai';
import { Cache } from '../Cache';
import { objectFromMap } from '../Utils';
import * as os from 'os';
import { getVerifyArgs, putVerifyArgs } from '../VerifyArgs';
import { VerifyArgs } from '../Verify';
import { deploy, faucetTokenBuildFile } from './DeployHelpers';
import { Dog__factory, Dog } from '../../../build/types';

describe('VerifyArgs', () => {
  it('gets and sets verify args', async () => {
    let cache = new Cache('test', false, os.tmpdir());

    let testContract = await deploy<Dog, Dog__factory, [string, string, string[]]>(
      'test/Dog.sol',
      ['spot', '0x0000000000000000000000000000000000000001', []],
      hre,
      { cache }
    );
    let verifyArgs1: VerifyArgs = { via: 'artifacts', address: '0x0000000000000000000000000000000000000000', constructorArguments: [] };
    let verifyArgs2: VerifyArgs = { via: 'buildfile', contract: testContract, buildFile: faucetTokenBuildFile, deployArgs: [] };

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
  });
});
