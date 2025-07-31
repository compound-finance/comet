# Makefile for verifying contracts


# Declare constants at the top
MARKET_UPDATE_MULTISIG = 0x7e14050080306cd36b47DE61ce604b3a1EC70c4e
MARKET_ADMIN_TIMELOCK_ADDRESS = 0x67174e10D3DeE790FdaB7eE0cBbAb64093072108
MARKET_UPDATE_PROPOSER = 0x3577D305984931111f2eCb449c91C473C4A985df
CONFIGURATOR_IMPL = 0x7cf6d0aD3f4B4BadcE860E7d45641BE790078E08
COMET_PROXY_ADMIN = 0x168097e9aDdC04859934a9C45823a151De6e0471
MARKET_ADMIN_PERMISSION_CHECKER = 0x68Fb67b0C9A2e7063760287dbe0ec89f7932E13d

SOLIDITY_COMPILER_VERSION = "0.8.15"
SENDER = "0x9825413dd3875E01B34451A7A7e066b2225a234E"
EVM_VERSION = "cancun"
OWNERS = '["0xDD659911EcBD4458db07Ee7cDdeC79bf8F859AbC", "0xda32C5AEE8Fc5C51Ed9a99f5608c33f435F740B4", "0x1D8e0b8F4CEd9262C9ac0c0870BF8B45D74ad9D9", "0x47526FDDBA0A5a7ef001FaaD4836b771B3e92522"]'
THRESHOLD = 2

#RPC_URL = "RPCUrlOfTheNetwork"
#SENDER = "0x470579d16401a36BF63b1428eaA7189FBdE5Fee9"
#ETHERSCAN_API_KEY = ""
#CHAIN_ID = ChainIdOfTheNetwork
#SALT = 'salt-salt-sale-salt'

include .env

# Define targets for each contract
verify-all: verify-MarketUpdateTimelock verify-MarketUpdateProposer verify-Configurator verify-CometProxyAdmin verify-MarketAdminPermissionChecker

# Deploying Safe
deploy-safe:
	@echo "Deploying Safe..."
	OWNERS=$(OWNERS) THRESHOLD=$(THRESHOLD) SALT=$(SALT) CHAIN_ID=$(CHAIN_ID) yarn hardhat run scripts/marketupdates/deploySafe.ts

# Deploying the contracts
deploy-contracts:
	@echo "Deploying contracts..."
	CHAIN_ID=$(CHAIN_ID) forge script forge/script/marketupdates/DeployContracts.s.sol:DeployContracts \
		--rpc-url $(RPC_URL) \
		--optimize \
		--optimizer-runs 1 \
		--use $(SOLIDITY_COMPILER_VERSION) \
		--evm-version $(EVM_VERSION) \
		--broadcast \
		--via-ir \
		-vvvv \
		--sender $(SENDER)
# 		\ --legacy

# Compute contracts addresses
compute-contracts-addresses:
	@echo "Computing contracts addresses..."
	CHAIN_ID=$(CHAIN_ID) forge script forge/script/marketupdates/ComputeContractsAddresses.s.sol:ComputeContractAddresses \
		--rpc-url $(RPC_URL) \
		--optimize \
		--optimizer-runs 1 \
		--use $(SOLIDITY_COMPILER_VERSION) \
		--evm-version $(EVM_VERSION) \
		--via-ir \
		-vvvv \
		--skip-simulation \
		--sender $(SENDER)

# Verifying MarketUpdateTimelock
verify-MarketUpdateTimelock:
	@echo "Verifying MarketUpdateTimelock..."
	forge verify-contract \
		--chain-id $(CHAIN_ID) \
		--compiler-version $(SOLIDITY_COMPILER_VERSION) \
		--optimizer-runs 1 \
		--constructor-args $(shell cast abi-encode "constructor(address,uint256)" $(SENDER) 172800) \
		--etherscan-api-key $(ETHERSCAN_API_KEY) \
		--watch \
		--via-ir \
		${MARKET_ADMIN_TIMELOCK_ADDRESS} \
		contracts/marketupdates/MarketUpdateTimelock.sol:MarketUpdateTimelock
# 		\ --verifier blockscout \
#   		--verifier-url 'https://unichain.blockscout.com/api/' \

# Verifying MarketUpdateProposer
verify-MarketUpdateProposer:
	@echo "Verifying MarketUpdateProposer..."
	forge verify-contract \
		--chain-id $(CHAIN_ID) \
		--compiler-version $(SOLIDITY_COMPILER_VERSION) \
		--optimizer-runs 1 \
		--constructor-args $(shell cast abi-encode "constructor(address,address,address,address)" $(SENDER) $(MARKET_UPDATE_MULTISIG) 0x0000000000000000000000000000000000000000 $(MARKET_ADMIN_TIMELOCK_ADDRESS)) \
		--etherscan-api-key $(ETHERSCAN_API_KEY) \
		--watch \
		--via-ir \
		${MARKET_UPDATE_PROPOSER} \
		contracts/marketupdates/MarketUpdateProposer.sol:MarketUpdateProposer
# 		\ --verifier blockscout \
#   		--verifier-url 'https://unichain.blockscout.com/api/' \

# Verifying CometProxyAdmin
verify-CometProxyAdmin:
	@echo "Verifying CometProxyAdmin..."
	forge verify-contract \
		--chain-id $(CHAIN_ID) \
		--compiler-version $(SOLIDITY_COMPILER_VERSION) \
		--optimizer-runs 1 \
		--constructor-args $(shell cast abi-encode "constructor(address)" $(SENDER)) \
		--etherscan-api-key $(ETHERSCAN_API_KEY) \
		--watch \
		--via-ir \
		${COMET_PROXY_ADMIN} \
		contracts/CometProxyAdmin.sol:CometProxyAdmin
# 		\ --verifier blockscout \
#   		--verifier-url 'https://unichain.blockscout.com/api/' \

# Verifying Configurator
verify-Configurator:
	@echo "Verifying Configurator..."
	forge verify-contract \
		--chain-id $(CHAIN_ID) \
		--compiler-version $(SOLIDITY_COMPILER_VERSION) \
		--optimizer-runs 1 \
		--etherscan-api-key $(ETHERSCAN_API_KEY) \
		--watch \
		--via-ir \
		${CONFIGURATOR_IMPL} \
		contracts/Configurator.sol:Configurator
# 		\ --verifier blockscout \
#   		--verifier-url 'https://unichain.blockscout.com/api/' \

# Verifying MarketAdminPermissionChecker
verify-MarketAdminPermissionChecker:
	@echo "Verifying MarketAdminPermissionChecker..."
	forge verify-contract \
		--chain-id $(CHAIN_ID) \
		--compiler-version $(SOLIDITY_COMPILER_VERSION) \
		--optimizer-runs 1 \
		--constructor-args $(shell cast abi-encode "constructor(address,address,address)" $(SENDER) $(MARKET_UPDATE_MULTISIG) 0x0000000000000000000000000000000000000000) \
		--etherscan-api-key $(ETHERSCAN_API_KEY) \
		--watch \
		--via-ir \
		${MARKET_ADMIN_PERMISSION_CHECKER} \
		contracts/marketupdates/MarketAdminPermissionChecker.sol:MarketAdminPermissionChecker
# 		\ --verifier blockscout \
#   		--verifier-url 'https://unichain.blockscout.com/api/' \
