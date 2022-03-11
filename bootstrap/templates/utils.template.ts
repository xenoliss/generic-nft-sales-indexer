import { BigInt } from "@graphprotocol/graph-ts"
import { Application, TransfersLookupTable } from "../generated/schema"

import { $CONSTANTS_IMPORT$ } from "./contract_addresses";

/**
 * Return the human readable name of the contract or "UNKNOWN" if unknown
 * @param contract The contract address
 * @returns The human readable name of the contract or "UNKNOWN" if unknown
 */
export function addressToContractName(contract: string): string {
    $CONTRACT_MAP$
}

/**
 * Load or create (if foes not exist) a `Application` entity
 * @param txHash The transaction hash
 * @returns The `Application` entity
 */
export function loadOrdCreateApplication(): Application {
    let application = Application.load("app");

    if (!application) {
        application = new Application("app");
        application.nextERC20TransferID = BigInt.fromI32(0);
        application.nextERC721TransferID = BigInt.fromI32(0);
        application.transfersLookupTablesToProcess = [];
    }

    return application
}


class LoadOrCreateLookupTableReturn {
    transfersLookupTable: TransfersLookupTable;
    created: bool;
}

/**
 * Load or create (if foes not exist) a `TransfersLookupTable` entity
 * @param txHash The transaction hash
 * @param blockNumber The block number
 * @param blockTimeStamp The block timestamp
 * @returns A `LoadOrCreateLookupTableReturn` type
 */
export function loadOrCreateLookupTable(txHash: string, blockNumber: BigInt, blockTimestamp: BigInt): LoadOrCreateLookupTableReturn {
    let created = false;
    let transfersLookupTable = TransfersLookupTable.load(txHash);

    if (!transfersLookupTable) {
        created = true;
        transfersLookupTable = new TransfersLookupTable(txHash);
        transfersLookupTable.blockNumber = blockNumber;
        transfersLookupTable.blockTimestamp = blockTimestamp;
        transfersLookupTable.erc20Transfers = [];
        transfersLookupTable.erc721Transfers = [];
    }

    return { transfersLookupTable, created };
}