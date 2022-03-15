import { BigInt, Bytes, store, ethereum } from "@graphprotocol/graph-ts";
import { Transfer } from "../generated/$ERC721_CONTRACT$/ERC721";
import { Application, ERC20Transfer, ERC721Transfer, NFTSale, TransfersLookupTable } from "../generated/schema";
import { NULL_ADDRESS } from "./constant";

import { addressToContractName, loadOrCreateLookupTable, loadOrdCreateApplication } from "./utils";

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////                                                         EVENT HANDLER                                                                   ///////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Has two jobs:
 * - Process the created `TransfersLookupTable` on previous blocks
 * - Process the a new `Transfer` event:
 *      - If ETH is sent along with the `Transfer` event this is most liekly a sale to registers it as a `NFTSale`
 *      - If not ETH value is sent along with the `Transfer` event this is *maybe* a sale but maybe not. It registers 
 * this in the application `transfersLookupTablesToProcess` that will be processed in future blocks to determine if
 * this was indeed a `NFTSale` or not 
 * @param event The `Transfer` event
 */
export function handleERC721Transfer(event: Transfer): void {
    let application = loadOrdCreateApplication();

    if (event.transaction.value.gt(BigInt.fromI32(0))) {
        // If some ETH was sent during the ERC721 transfer this is most likely a sale
        // So we can directly create a new `NFTSale` entity and skip the `transfersLookupTablesToProcess` stuff
        _registerETHSale(event, application);
    } else {
        // If not ETH was sent during the `ERC721Transfer` this is *maybe* a sale
        // We register this `ERC721Transfer` in the associated `TransfersLookupTable` and store that in the
        // application `transfersLookupTablesToProcess` for further investiagtion (that will determine if
        // this `ERC721Transfer` is a sale or not)
        _registerERC721Transfer(event, application);
    }

    application.save();
}

/**
 * Create a new `ERC721Transfer` entity that is registered in its associated `TransfersLookupTable`.
 * @param event The `Transfer` event
 */
function _registerETHSale(event: Transfer, application: Application): void {
    let blockNumber = event.block.number;
    let blockTimestamp = event.block.timestamp;
    let interacted_with = event.transaction.to!;

    let from = event.params.from;
    let to = event.params.to;
    let tokenId = event.params.tokenId;

    let erc721TransferID = application.nextERC721TransferID;

    // Create the ERC721Transfer entity
    let erc721Transfer = new ERC721Transfer(erc721TransferID.toString());
    erc721Transfer.contractAddress = event.address;
    erc721Transfer.contractName = addressToContractName(event.address.toHexString());
    erc721Transfer.from = from;
    erc721Transfer.to = to;
    erc721Transfer.tokenId = tokenId;
    erc721Transfer.save();

    // Fill the associated TransfersLookupTable
    let loadOrCreateLookupTableReturn = loadOrCreateLookupTable(
        event.transaction.hash.toHexString(),
        blockNumber,
        blockTimestamp,
        interacted_with
    );
    let transfersLookupTable = loadOrCreateLookupTableReturn.transfersLookupTable;
    let transfersLookupTableCreated = loadOrCreateLookupTableReturn.created;

    // Register the `ERC721Transfer`
    let erc721Transfers = transfersLookupTable.erc721Transfers;
    erc721Transfers.push(erc721Transfer.id);
    transfersLookupTable.erc721Transfers = erc721Transfers;

    // Set the eth value
    transfersLookupTable.ethValue = event.transaction.value;
    transfersLookupTable.save();

    // Update and save the Application
    application.nextERC721TransferID = application.nextERC721TransferID.plus(BigInt.fromI32(1));

    // Create the NFTSale if it did not already exist (may be the case for bundle)
    // Paid with ETH
    if (transfersLookupTableCreated) {
        let nftSale = new NFTSale(transfersLookupTable.id);
        nftSale.blockNumber = blockNumber;
        nftSale.blockTimestamp = blockTimestamp;
        nftSale.interacted_with = interacted_with;
        nftSale.buyer = to;
        nftSale.seller = from;
        nftSale.paymentTokenAddress = changetype<Bytes>(Bytes.fromHexString(NULL_ADDRESS));
        nftSale.paymentTokenName = "ETH";
        nftSale.transfersLookupTable = transfersLookupTable.id;
        nftSale.save();
    }
}

/**
 * Create a new `ERC721Transfer` entity that is registered in its associated `TransfersLookupTable`.
 * @param event The `Transfer` event
 */
function _registerERC721Transfer(event: Transfer, application: Application): void {
    let blockNumber = event.block.number;
    let blockTimestamp = event.block.timestamp;
    let interacted_with = event.transaction.to!;

    let from = event.params.from;
    let to = event.params.to;
    let tokenId = event.params.tokenId;

    let erc721TokenId = application.nextERC721TransferID;

    // Create the ERC20Transfer entity
    let erc721Transfer = new ERC721Transfer(erc721TokenId.toString());
    erc721Transfer.contractAddress = event.address;
    erc721Transfer.contractName = addressToContractName(event.address.toHexString());
    erc721Transfer.from = from;
    erc721Transfer.to = to;
    erc721Transfer.tokenId = tokenId;
    erc721Transfer.save();

    // Fill the associated TransfersLookupTable with this ERC20Transfer
    let loadOrCreateLookupTableReturn = loadOrCreateLookupTable(
        event.transaction.hash.toHexString(),
        blockNumber,
        blockTimestamp,
        interacted_with
    );

    let transfersLookupTable = loadOrCreateLookupTableReturn.transfersLookupTable;
    let transfersLookupTableCreated = loadOrCreateLookupTableReturn.created;

    let erc721Transfers = transfersLookupTable.erc721Transfers;
    erc721Transfers.push(erc721Transfer.id);
    transfersLookupTable.erc721Transfers = erc721Transfers;
    transfersLookupTable.save();

    // Update and save the Application
    application.nextERC721TransferID = application.nextERC721TransferID.plus(BigInt.fromI32(1));

    // Register the transfersLookupTable if we just created it
    if (transfersLookupTableCreated) {
        let transfersLookupTablesToProcess = application.transfersLookupTablesToProcess;
        transfersLookupTablesToProcess.push(transfersLookupTable.id);
        application.transfersLookupTablesToProcess = transfersLookupTablesToProcess;
    }

    application.save();
}

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////                                                         BLOCK HANDLER                                                                   ///////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


/**
 * Process all the `TransfersLookupTable`s created during the previous blocks:
 * - `TransfersLookupTable`s that have matching `ERC20Transfer` and `ERC721Transfer` are linked into a newly created `Sale` entity
 * - `TransfersLookupTable`s that don't correspond to sales are removed from the store with their associated `ERC20Transfer` and `ERC721Transfer` entities
 * @param block The ethereum `Block` block
 */
export function handleBlock(block: ethereum.Block): void {
    let blockNumber = block.number;
    let application = loadOrdCreateApplication();

    // Get a copy of the list of `TransfersLookupTable`
    let transfersLookupTablesToProcess = application.transfersLookupTablesToProcess;

    // We only want to process the `TransfersLookupTable`s from previous block
    // This list will be appended with the `TransfersLookupTable` that are from the same block and need to be kept
    // and processed later
    let transfersLookupTablesToKeep: string[] = [];

    for (let i = 0; i < transfersLookupTablesToProcess.length; i++) {
        let transfersLookupTable = TransfersLookupTable.load(transfersLookupTablesToProcess[i])!;

        if (transfersLookupTable.blockNumber.lt(blockNumber)) {
            // Only process `TransfersLookupTable` created on previous blocks
            let nftSale = _tryBuildNFTSale(transfersLookupTable);
            if (!nftSale) {
                // If no NFTSale entity was created remove the TransfersLookupTable
                // along with its ERC20Transfer and ERC721Transfer entities 
                _removeEntitiesFromStore(transfersLookupTable);
            } else {
                // If an `NFTSale` have been built save it
                nftSale.save();
            }
        } else {
            transfersLookupTablesToKeep.push(transfersLookupTable.id);
        }
    }

    // Reset the list of `TransfersLookupTable` to process
    application.transfersLookupTablesToProcess = transfersLookupTablesToKeep;
    application.save();
}

/**
 * Try to build an `NFTSale` entity from the given `TransfersLookupTable`. The `NFTSale` is built only if:
 * - Both `erc20Transfers` and `erc721Transfers` are not empty
 * - All the `ERC20Transfer` of `erc20Transfers` use the same `ERC20Token`
 * @param transfersLookupTable The `TransfersLookupTable`
 * @returns an `NFTSale` if this `TransfersLookupTable` was actually an NFT sale else null is returned
 */
function _tryBuildNFTSale(transfersLookupTable: TransfersLookupTable): NFTSale | null {
    let erc20Transfers = transfersLookupTable.erc20Transfers;
    let erc721Transfers = transfersLookupTable.erc721Transfers;

    // If one of the transfers list is empty that's not a sale
    if (erc20Transfers.length == 0 || erc721Transfers.length == 0) return null;

    let firstErc20Transfer = ERC20Transfer.load(erc20Transfers[0])!;
    let firstErc721Transfer = ERC721Transfer.load(erc721Transfers[0])!;

    // If one of the ERC20 tokens differ from the others that's not a sale
    let contractAddress = firstErc20Transfer.contractAddress;
    for (let i = 0; i < erc20Transfers.length; i++) {
        let erc20Transfer = ERC20Transfer.load(erc20Transfers[i])!;
        if (erc20Transfer.contractAddress != contractAddress) return null;
    }

    // Else all tests passed, it's a sale
    let nftSale = new NFTSale(transfersLookupTable.id);
    nftSale.blockNumber = transfersLookupTable.blockNumber;
    nftSale.blockTimestamp = transfersLookupTable.blockTimestamp;
    nftSale.interacted_with = transfersLookupTable.interacted_with;
    nftSale.buyer = firstErc721Transfer.to;
    nftSale.seller = firstErc721Transfer.from;
    nftSale.paymentTokenAddress = firstErc20Transfer.contractAddress;
    nftSale.paymentTokenName = firstErc20Transfer.contractName;
    nftSale.transfersLookupTable = transfersLookupTable.id;
    return nftSale;
}

function _removeEntitiesFromStore(transfersLookupTable: TransfersLookupTable): void {
    let erc20Transfers = transfersLookupTable.erc20Transfers;
    let erc721Transfers = transfersLookupTable.erc721Transfers;

    // Remove the `TransfersLookupTable` entity
    store.remove("TransfersLookupTable", transfersLookupTable.id);

    // Remove the `ERC20Transfer` entities
    for (let i = 0; i < erc20Transfers.length; i++) {
        store.remove("ERC20Transfer", erc20Transfers[i]);
    }

    // Remove the `ERC721Transfer` entities
    for (let i = 0; i < erc721Transfers.length; i++) {
        store.remove("ERC721Transfer", erc721Transfers[i]);
    }
}