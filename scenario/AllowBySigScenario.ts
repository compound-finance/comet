import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#allowBySig > allows a user to authorize a manager by signature',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await betty.allowBySig({
      owner: albert.address,
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      signature,
    });

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;
  }
);

scenario(
  'Comet#allowBySig > fails if owner argument is altered',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty, charles } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expect(
      betty.allowBySig({
        owner: charles.address, // altered owner
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('owner is not signatory');
  }
);

scenario(
  'Comet#allowBySig > fails if manager argument is altered',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty, charles } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: charles.address, // altered manager
        isAllowed: true,
        nonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('owner is not signatory');
  }
);

scenario(
  'Comet#allowBySig > fails if isAllowed argument is altered',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: false, // altered isAllowed
        nonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('owner is not signatory');
  }
);

scenario(
  'Comet#allowBySig > fails if nonce argument is altered',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce: nonce.add(1), // altered nonce
        expiry,
        signature,
      })
    ).to.be.revertedWith('owner is not signatory');
  }
);

scenario(
  'Comet#allowBySig > fails if expiry argument is altered',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry,
      chainId: await world.chainId(),
    });

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry: expiry + 100, // altered expiry
        signature,
      })
    ).to.be.revertedWith('owner is not signatory');
  }
);

scenario(
  'Comet#allowBySig fails if signature contains invalid nonce',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

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

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce: invalidNonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('invalid nonce');
  }
);

scenario(
  'Comet#allowBySig rejects a repeated message',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const expiry = (await world.timestamp()) + 10;

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

    // repeated call
    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('invalid nonce');
  }
);

scenario(
  'Comet#allowBySig fails for invalid expiry',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

    const nonce = await comet.userNonce(albert.address);
    const invalidExpiry = (await world.timestamp()) - 1;

    const signature = await albert.signAuthorization({
      manager: betty.address,
      isAllowed: true,
      nonce,
      expiry: invalidExpiry,
      chainId: await world.chainId(),
    });

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry: invalidExpiry,
        signature,
      })
    ).to.be.revertedWith('signed transaction expired');
  }
);

scenario(
  'Comet#allowBySig fails if v not in {27,28}',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

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

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('invalid value: v');
  }
);

scenario(
  'Comet#allowBySig fails if s is too high',
  { upgrade: true },
  async ({ comet, actors }, world) => {
    const { albert, betty } = actors;

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;

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

    await expect(
      betty.allowBySig({
        owner: albert.address,
        manager: betty.address,
        isAllowed: true,
        nonce,
        expiry,
        signature,
      })
    ).to.be.revertedWith('invalid value: s');
  }
);
