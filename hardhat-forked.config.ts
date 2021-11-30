// TODO: import config from hardhat.config.ts; copy all properties

export default {
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.alchemyapi.io/v2/<key>", // TODO: actual API key
        blockNumber: 11095000
      }
    }
  },
};