# ERC20 Testing

The erc20.spec in this directory tests some common Ethereum tokens for unusual behavior.

_verifyERC20.sh_ - tests against a basic dummy erc20 token implementation. Should pass.

_verifyUSDT.sh_ - tests against the deployed USDT token. Should fail because of its potential fee on transfer.

_verifyUSDC.sh_ - tests against the deployed USDC token code. Should pass.