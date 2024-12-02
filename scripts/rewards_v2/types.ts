export type CampaignType = 'start' | 'finish'

export type IncentivizationCampaignData = {
    root: string;
    network: string;
    market: string;
    type: CampaignType;
    blockNumber: number;
    generatedTimestamp: number;
    data: {
        [address: string]: Proof;
    };
}

export type Proof = {
    accrue: string;
    proof: string[];
    index: number;
}

export type MulticallAddressesConfig = {
    [network: string]: string; // address of multicall contract
}

export type TransferEventsFetchSettings = {
    [network: string]: { delaySeconds: number, chunkSize: number };
}