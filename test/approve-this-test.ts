import { ethers, exp, expect, makeProtocol } from './helpers';

describe('approveThis', function () {
  describe('asset is Comet', function() {
    it('isAllowed defaults to false', async () => {
      const protocol = await makeProtocol();
      const { comet, governor } = protocol;

      expect(await comet.isAllowed(comet.address, governor.address)).to.be.false;
    });

    it('allows governor to authorize a manager', async () => {
      const protocol = await makeProtocol();
      const { comet, governor } = protocol;

      await comet.connect(governor).approveThis(governor.address, comet.address, ethers.constants.MaxUint256);

      expect(await comet.isAllowed(comet.address, governor.address)).to.be.true;
    });

    it('allows governor to rescind authorization', async () => {
      const protocol = await makeProtocol();
      const { comet, governor, users: [ user ] } = protocol;

      await comet.connect(governor).approveThis(user.address, comet.address, ethers.constants.MaxUint256);

      expect(await comet.isAllowed(comet.address, user.address)).to.be.true;

      await comet.connect(governor).approveThis(user.address, comet.address, ethers.constants.Zero);

      expect(await comet.isAllowed(comet.address, user.address)).to.be.false;
    });

    it('reverts if not called by governor', async () => {
      const protocol = await makeProtocol();
      const { comet, users: [ user ] } = protocol;

      await expect(comet.connect(user).approveThis(user.address, comet.address, ethers.constants.MaxUint256))
        .to.be.revertedWith("custom error 'Unauthorized()'");
    });
  });

  describe('asset is non-Comet ERC20', function() {
    it('isAllowed defaults to false', async () => {
      const protocol = await makeProtocol();
      const { comet, tokens, governor } = protocol;
      const { COMP } = tokens;

      expect(await COMP.allowance(comet.address, governor.address)).to.be.equal(0);
    });

    it('allows governor to authorize a manager', async () => {
      const protocol = await makeProtocol();
      const { comet, tokens, governor } = protocol;
      const { COMP } = tokens;

      const newAllowance = exp(50, 18);
      await comet.connect(governor).approveThis(governor.address, COMP.address, newAllowance);

      expect(await COMP.allowance(comet.address, governor.address)).to.be.equal(newAllowance);
    });

    it('allows governor to rescind authorization', async () => {
      const protocol = await makeProtocol();
      const { comet, tokens, governor, users: [ user ] } = protocol;
      const { COMP } = tokens;

      await comet.connect(governor).approveThis(user.address, COMP.address, ethers.constants.MaxUint256);

      expect(await COMP.allowance(comet.address, user.address)).to.be.equal(ethers.constants.MaxUint256);

      await comet.connect(governor).approveThis(user.address, COMP.address, ethers.constants.Zero);

      expect(await COMP.allowance(comet.address, user.address)).to.be.equal(ethers.constants.Zero);
    });

    it('reverts if not called by governor', async () => {
      const protocol = await makeProtocol();
      const { comet, tokens, users: [ user ] } = protocol;
      const { COMP } = tokens;

      await expect(comet.connect(user).approveThis(user.address, COMP.address, ethers.constants.MaxUint256))
        .to.be.revertedWith("custom error 'Unauthorized()'");
    });
  });
});