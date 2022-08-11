import { expect } from 'chai';
import { buildToken, deployBuild, faucetTokenBuildFile, tokenArgs, hre } from './DeployHelpers';

// TODO: Test verify
// TODO: Test caching

describe('Deploy', () => {
  it('deploy', async () => {
    let token = await buildToken();
    expect(await token.symbol()).to.equal('TEST');
  });

  it('deployBuild', async () => {
    let token = await deployBuild(faucetTokenBuildFile, tokenArgs, hre, { network: 'test-network' });
    expect(await token.symbol()).to.equal('TEST');
  });
});
