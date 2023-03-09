import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Overrides } from 'ethers';
import { ERC20 } from '../../build/types';
import CometActor from './CometActor';
import { AddressLike, resolveAddress } from './Address';
import { constants } from 'ethers';
import { wait } from '../../test/helpers';

export default class CometAsset {
  token: ERC20;
  address: string;

  constructor(token: ERC20) {
    this.token = token;
    this.address = token.address;
  }

  static fork(asset: CometAsset): CometAsset {
    return new CometAsset(asset.token);
  }

  async balanceOf(account: SignerWithAddress | string): Promise<bigint> {
    const address = typeof(account) === 'string' ? account : account.address;
    return (await this.token.balanceOf(address)).toBigInt();
  }

  async transfer(from: CometActor | SignerWithAddress, amount: number | bigint, recipient: CometAsset | string, overrides: Overrides = {}) {
    const recipientAddress = typeof(recipient) === 'string' ? recipient : recipient.address;
    const signer = from instanceof CometActor ? from.signer : from;
    await wait(this.token.connect(signer).transfer(recipientAddress, amount, overrides));
  }

  async approve(from: CometActor | SignerWithAddress, spender: AddressLike, amount?: number | bigint) {
    const spenderAddress = resolveAddress(spender);
    const finalAmount = amount ?? constants.MaxUint256;
    const signer = from instanceof CometActor ? from.signer : from;
    await wait(this.token.connect(signer).approve(spenderAddress, finalAmount));
  }

  async allowance(owner: AddressLike, spender: AddressLike): Promise<bigint> {
    const ownerAddress = resolveAddress(owner);
    const spenderAddress = resolveAddress(spender);
    return (await this.token.allowance(ownerAddress, spenderAddress)).toBigInt();
  }

  async decimals(): Promise<number> {
    return this.token.decimals();
  }
}
