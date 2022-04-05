// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat';
import { deployComet } from '../src/deploy';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';

async function verifyContract(address: string, constructorArguments) {
  try {
    return await hre.run('verify:verify', {
      address,
      constructorArguments,
    });
  } catch (e) {
    const regex = /Already Verified/i;
    const result = e.message.match(regex);
    if (result) {
      console.log(
        'Contract at address ' + address + ' is already verified on Etherscan'
      );
      return;
    }
    throw e;
  }
}

async function main() {
  // address governor;
  // address pauseGuardian;
  // address baseToken;
  // address baseTokenPriceFeed;
  // address extensionDelegate;

  // uint64 kink;
  // uint64 perYearInterestRateSlopeLow;
  // uint64 perYearInterestRateSlopeHigh;
  // uint64 perYearInterestRateBase;
  // uint64 reserveRate;
  // uint64 storeFrontPriceFactor;
  // uint64 trackingIndexScale;
  // uint64 baseTrackingSupplySpeed;
  // uint64 baseTrackingBorrowSpeed;
  // uint104 baseMinForRewards;
  // uint104 baseBorrowMin;
  // uint104 targetReserves;

  // AssetConfig[] assetConfigs;
  let args = [
    {
      governor: "0x920002E8e3210f22B2759f320081694Feadc444a",
      pauseGuardian: "0x1C2C3c2E3232080e0738187520372e30Ce2e34CB",
      baseToken: "0x4004FdD0eC968d955862806d500988D58B2e7030",
      baseTokenPriceFeed: "0x9211c6b3BF41A10F78539810Cf5c64e1BB78Ec60",
      extensionDelegate: "0xF9C3eB5d8113D26F0e0F3A20163c0cFBA8E12941",
      kink: "800000000000000000",
      perYearInterestRateSlopeLow: "20000000000000000",
      perYearInterestRateSlopeHigh: "100000000000000000",
      perYearInterestRateBase: "10000000000000000",
      reserveRate: "100000000000000000",
      storeFrontPriceFactor: "0",
      trackingIndexScale: "1000000000000000",
      baseTrackingSupplySpeed: "0",
      baseTrackingBorrowSpeed: "0",
      baseMinForRewards: "1",
      baseBorrowMin: "1000000",
      targetReserves: "0",
      assetConfigs: 
      [
        {
          asset: "0xE38227061686DF3cA2B48f270F1B037DF8637e69",
          priceFeed: "0xECF93D14d25E02bA2C13698eeDca9aA98348EFb6",
          decimals: 18,
          borrowCollateralFactor: "600000000000000000",
          liquidateCollateralFactor: "700000000000000000",
          liquidationFactor: "900000000000000000",
          supplyCap: "100000000000000000000",
        },      
        {
          asset: "0x9266BE32DFcD78984775B2920927EfBE44C5CEfa",
          priceFeed: "0x6135b13325bfC4B00278B4abC5e20bbce2D6580e",
          decimals: 8,
          borrowCollateralFactor: "400000000000000000",
          liquidateCollateralFactor: "500000000000000000",
          liquidationFactor: "900000000000000000",
          supplyCap: "10000000000",
        },
        {
          asset: "0x05C2cEcF8c4C30e8bE5c396488f0cBE53176f620",
          priceFeed: "0x9326BFA02ADD2366b30bacB125260Af641031331",
          decimals: 18,
          borrowCollateralFactor: "700000000000000000",
          liquidateCollateralFactor: "800000000000000000",
          liquidationFactor: "900000000000000000",
          supplyCap: "ßß100000000000000000000",
        },
        {
          asset: "0x8cB051f87727E50879732f1e4f7B7D1D2B499267",
          priceFeed: "0xDA5904BdBfB4EF12a3955aEcA103F51dc87c7C39",
          decimals: 18,
          borrowCollateralFactor: "700000000000000000",
          liquidateCollateralFactor: "800000000000000000",
          liquidationFactor: "900000000000000000",
          supplyCap: "100000000000000000000",
        },
        {
          asset: "0x9E787a03A3E05C375dC4bE552862Edfc51106722",
          priceFeed: "0x396c5E36DD0a0F5a5D33dae44368D4193f69a1F0",
          decimals: 18,
          borrowCollateralFactor: "400000000000000000",
          liquidateCollateralFactor: "500000000000000000",
          liquidationFactor: "900000000000000000",
          supplyCap: "10000000000000000000",
        }
      ]
    }
  ];

  console.log('Starting verification!')

  await verifyContract("0xa52dcb6bd70ac1af6aefd76d52726c38aff0046c", args);

  console.log('Finished verifying!')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
