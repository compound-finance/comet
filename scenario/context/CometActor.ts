import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumberish, Signature, ethers, ContractReceipt, Overrides, PayableOverrides } from 'ethers';
import { CometContext } from './CometContext';
import { AddressLike, resolveAddress } from './Address';
import { ERC20__factory } from '../../build/types';
import { baseBalanceOf } from '../../test/helpers';

const types = {
  Authorization: [
    { name: 'owner', type: 'address' },
    { name: 'manager', type: 'address' },
    { name: 'isAllowed', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
};

function floor(n: number): bigint {
  return BigInt(Math.floor(n));
}

export default class CometActor {
  name: string;
  signer: SignerWithAddress;
  address: string;
  context: CometContext;
  info: object;

  constructor(
    name: string,
    signer: SignerWithAddress,
    address: string,
    context: CometContext,
    info: object = {}
  ) {
    this.name = name;
    this.signer = signer;
    this.address = address;
    this.context = context;
    this.info = info;
  }

  static fork(actor: CometActor, context: CometContext): CometActor {
    return new CometActor(actor.name, actor.signer, actor.address, context, actor.info);
  }

  async getEthBalance() {
    return this.signer.getBalance();
  }

  async getErc20Balance(tokenAddress: string): Promise<bigint> {
    const erc20 = ERC20__factory.connect(tokenAddress, this.signer);
    return (await erc20.balanceOf(this.signer.address)).toBigInt();
  }

  async getCometBaseBalance(): Promise<bigint> {
    const comet = await this.context.getComet();
    return baseBalanceOf(comet, this.signer.address);
  }

  async getCometCollateralBalance(tokenAddress: string): Promise<bigint> {
    const comet = await this.context.getComet();
    return (await comet.collateralBalanceOf(this.signer.address, tokenAddress)).toBigInt();
  }

  async sendEth(recipient: AddressLike, amount: number) {
    const tx = await this.signer.sendTransaction({
      to: resolveAddress(recipient),
      value: floor(amount * 1e18),
    });
    await tx.wait();
  }

  async transferErc20(tokenAddress: string, dst: string, amount: bigint): Promise<ContractReceipt> {
    const erc20 = ERC20__factory.connect(tokenAddress, this.signer);
    return await (await erc20.transfer(dst, amount)).wait();
  }

  async allow(manager: CometActor | string, isAllowed: boolean): Promise<ContractReceipt> {
    if (typeof manager !== 'string') manager = manager.address;
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).allow(manager, isAllowed)).wait();
  }

  async safeSupplyAsset({ asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    await this.context.bumpSupplyCaps({ [asset]: amount });
    return await (await comet.connect(this.signer).supply(asset, amount)).wait();
  }

  async supplyAsset({ asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).supply(asset, amount)).wait();
  }

  async supplyAssetFrom({ src, dst, asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).supplyFrom(src, dst, asset, amount)).wait();
  }

  async transferAsset({ dst, asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).transferAsset(dst, asset, amount)).wait();
  }

  async transferAssetFrom({ src, dst, asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).transferAssetFrom(src, dst, asset, amount)).wait();
  }

  async withdrawAsset({ asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).withdraw(asset, amount)).wait();
  }

  async withdrawAssetFrom({ src, dst, asset, amount }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).withdrawFrom(src, dst, asset, amount)).wait();
  }

  async absorb({ absorber, accounts }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).absorb(absorber, accounts)).wait();
  }

  async signAuthorization({
    manager,
    isAllowed,
    nonce,
    expiry,
    chainId,
  }: {
    manager: string;
    isAllowed: boolean;
    nonce: BigNumberish;
    expiry: number;
    chainId: number;
  }): Promise<Signature> {
    const comet = await this.context.getComet();
    const domain = {
      name: await comet.name(),
      version: await comet.version(),
      chainId: chainId,
      verifyingContract: comet.address,
    };
    const value = {
      owner: this.address,
      manager,
      isAllowed,
      nonce,
      expiry,
    };
    const rawSignature = await this.signer._signTypedData(domain, types, value);
    return ethers.utils.splitSignature(rawSignature);
  }

  async allowBySig({
    owner,
    manager,
    isAllowed,
    nonce,
    expiry,
    signature,
  }: {
    owner: string;
    manager: string;
    isAllowed: boolean;
    nonce: BigNumberish;
    expiry: number;
    signature: Signature;
  }): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet
      .connect(this.signer)
      .allowBySig(owner, manager, isAllowed, nonce, expiry, signature.v, signature.r, signature.s)).wait();
  }

  async invoke({ actions, calldata }, overrides?: PayableOverrides): Promise<ContractReceipt> {
    const bulker = await this.context.getBulker();
    return await (await bulker.connect(this.signer).invoke(actions, calldata, { ...overrides })).wait();
  }

  async show() {
    return console.log(`Actor#${this.name}{${JSON.stringify(this.info)}}`);
  }

  /* ===== Admin-only functions ===== */

  async withdrawReserves(to: string, amount: BigNumberish, overrides?: Overrides): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).withdrawReserves(to, amount, { ...overrides })).wait();
  }

  async pause({
    supplyPaused = false,
    transferPaused = false,
    withdrawPaused = false,
    absorbPaused = false,
    buyPaused = false,
  }, overrides?: Overrides
  ): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (
      await comet
        .connect(this.signer)
        .pause(supplyPaused, transferPaused, withdrawPaused, absorbPaused, buyPaused, { ...overrides })
    ).wait();
  }

  async approveThis(manager: string, asset: string, amount: BigNumberish, overrides?: Overrides): Promise<ContractReceipt> {
    const comet = await this.context.getComet();
    return await (await comet.connect(this.signer).approveThis(manager, asset, amount, { ...overrides })).wait();
  }

  async deployAndUpgradeTo(configuratorProxy: string, cometProxy: string, overrides?: Overrides): Promise<ContractReceipt> {
    const proxyAdmin = await this.context.getCometAdmin();
    return await (await proxyAdmin.connect(this.signer).deployAndUpgradeTo(configuratorProxy, cometProxy, { ...overrides })).wait();
  }
}
