import { scenario } from './CometContext';
import { expect } from 'chai';

scenario("my scenario", {}, async ({players}, world) => {
  expect(await players()).to.eql(["0x29e31E1eE143a76039F00860d3Bd25804357f0b2"]);
});

scenario("add remote token",
  {
    remote_token: { network: 'mainnet', address: '0x6b175474e89094c44da98b954eedeac495271d0f', args: [1337] }
  }, async ({remoteToken}, world) => {
    expect(await remoteToken.symbol()).to.equal('DAI');
  });

scenario.skip("scen 2", {}, async (context, world) => {
  expect(context.dog).to.equal("jack");
});

scenario("scen 3", {}, async (context, world) => {
  expect(context.dog).to.equal("spot");
});
