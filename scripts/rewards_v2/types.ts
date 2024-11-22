export type CampaignType = 'start' | 'finish'

export type IncentivizationCampaignData = {
    root: string;
    network: string;
    market: string;
    type: CampaignType;
    blockNumber: number;
    generatedTimestamp: number;
    data: {
        [address: string]: {
            accrue: string;
            proof: string[];
            index: number;
        };
    };
}