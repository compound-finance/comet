import { BigNumberish, Contract, Signer } from 'ethers';
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

  async balanceOf(actorOrAddress: string | CometActor): Promise<bigint> {
    let address: string;
    if (typeof(actorOrAddress) === 'string') {
      address = actorOrAddress;
    } else {
      address = actorOrAddress.address;
    }

    return (await this.token.balanceOf(address)).toBigInt();
  }

  async transfer(from: CometActor, amount: number | bigint, recipient: CometAsset | string) {
    let recipientAddress = typeof(recipient) === 'string' ? recipient : recipient.address;

    await wait(this.token.connect(from.signer).transfer(recipientAddress, amount));
  }

  async approve(from: CometActor, spender: AddressLike, amount?: number) {
    let spenderAddress = resolveAddress(spender)
    let finalAmount = amount ?? constants.MaxUint256;
    await wait(this.token.connect(from.signer).approve(spenderAddress, finalAmount));
  }
}
