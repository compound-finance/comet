import { scenario } from './context/CometContext';
import { expectRevertCustom } from './utils';
import { expect } from 'chai';

scenario(
  'Comet#allowBySig > allows a user to authorize a manager by signature',
  {},
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 1_000;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    const txn = await betty.allowBySig({
      owner: albert.address,
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      signature,
    });

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

    return txn; // return txn to measure gas
  }
);

// Note: These revert scenarios may need to add `upgrade` if Hardhat fails to
//  recognize custom errors received in fallback functions that originate from external artifacts.
// CometExt is an external artifact here unless we redeploy it.
// Related: https://github.com/NomicFoundation/hardhat/issues/1875
scenario(
  'Comet#allowBySig > fails if owner argument is altered',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, charles } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: charles.address, // altered owner
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      }),
      'BadSignatory()'
    );
  }
);

scenario(
  'Comet#allowBySig > fails if manager argument is altered',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, charles } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: charles.address, // altered manager
        isAllowed: true,
        nonce,
        expiry,
        signature,
      }),
      'BadSignatory()'
    );
  }
);

scenario(
  'Comet#allowBySig > fails if isAllowed argument is altered',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: false, // altered isAllowed
        nonce,
        expiry,
        signature,
      }),
      'BadSignatory()'
    );
  }
);

scenario(
  'Comet#allowBySig > fails if nonce argument is altered',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce: nonce.add(1), // altered nonce
        expiry,
        signature,
      }),
      'BadSignatory()'
    );
  }
);

scenario(
  'Comet#allowBySig > fails if expiry argument is altered',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry: expiry + 100, // altered expiry
        signature,
      }),
      'BadSignatory()'
    );
  }
);

scenario(
  'Comet#allowBySig fails if signature contains invalid nonce',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const invalidNonce = nonce.add(1);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce: invalidNonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce: invalidNonce,
        expiry,
        signature,
      }),
      'BadNonce()'
    );
  }
);

scenario(
  'Comet#allowBySig rejects a repeated message',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10000;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    // valid call
    await betty.allowBySig({
      owner: albert.address,
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      signature,
    });

    // repeated callRevertCustom
    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      }),
      'BadNonce()'
    );
  }
);

scenario(
  'Comet#allowBySig fails for invalid expiry',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const invalidExpiry = (await world.timestamp()) - 1;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry: invalidExpiry,
      chainId: await world.chainId(),
    });

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry: invalidExpiry,
        signature,
      }),
      'SignatureExpired()'
    );
  }
);

scenario(
  'Comet#allowBySig fails if v not in {27,28}',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    signature.v = 26;

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      }),
      'InvalidValueV()'
    );
  }
);

scenario(
  'Comet#allowBySig fails if s is too high',
  { },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    await context.mineBlocks(1); // note: in case init took a while
    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    // 1 greater than the max value of s
    signature.s = '0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A1';

    await expectRevertCustom(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      }),
      'InvalidValueS()'
    );
  }
);
