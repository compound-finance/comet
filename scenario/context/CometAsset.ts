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

  async balanceOf(actorOrAddress: string | CometActor): Promise<bigint> {
    let address: string;
    if (typeof(actorOrAddress) === 'string') {
      address = actorOrAddress;
    } else {
      address = actorOrAddress.address;
    }

    return (await this.token.balanceOf(address)).toBigInt();
  }

  async transfer(from: CometActor, amount: number | bigint, recipient: CometAsset | string, overrides: Overrides = {}) {
    let recipientAddress = typeof(recipient) === 'string' ? recipient : recipient.address;

    await wait(this.token.connect(from.signer).transfer(recipientAddress, amount, overrides));
  }

  async approve(from: CometActor, spender: AddressLike, amount?: number | bigint) {
    let spenderAddress = resolveAddress(spender);
    let finalAmount = amount ?? constants.MaxUint256;
    await wait(this.token.connect(from.signer).approve(spenderAddress, finalAmount));
  }

  async allowance(owner: AddressLike, spender: AddressLike): Promise<bigint> {
    let ownerAddress = resolveAddress(owner);
    let spenderAddress = resolveAddress(spender);
    return (await this.token.allowance(ownerAddress, spenderAddress)).toBigInt();
  }

  async decimals(): Promise<number> {
    return this.token.decimals();
  }
}
