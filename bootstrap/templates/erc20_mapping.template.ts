import { BigInt } from "@graphprotocol/graph-ts";
import { Transfer } from "../generated/$ERC20_CONTRACT$/ERC20";
import { ERC20Transfer } from "../generated/schema";

import { addressToContractName, loadOrCreateLookupTable, loadOrdCreateApplication } from "./utils";

/**
 * Create a new `ERC20Transfer` entity that is registered in its associated `TransfersLookupTable`.
 * @param event The `Transfer` event
 */
export function handleERC20Transfer(event: Transfer): void {
  let blockNumber = event.block.number;
  let blockTimestamp = event.block.timestamp;

  let from = event.params.from;
  let to = event.params.to;
  let value = event.params.value;

  let application = loadOrdCreateApplication();
  let erc20TokenId = application.nextERC20TransferID;

  // Create the ERC20Transfer entity
  let erc20Transfer = new ERC20Transfer(erc20TokenId.toString());
  erc20Transfer.contractAddress = event.address;
  erc20Transfer.contractName = addressToContractName(event.address.toHexString());
  erc20Transfer.from = from;
  erc20Transfer.to = to;
  erc20Transfer.value = value;
  erc20Transfer.save();

  // Fill the associated TransfersLookupTable with this ERC20Transfer
  let loadOrCreateLookupTableReturn = loadOrCreateLookupTable(event.transaction.hash.toHexString(), blockNumber, blockTimestamp);
  let transfersLookupTable = loadOrCreateLookupTableReturn.transfersLookupTable;
  let transfersLookupTableCreated = loadOrCreateLookupTableReturn.created;

  let erc20Transfers = transfersLookupTable.erc20Transfers;
  erc20Transfers.push(erc20Transfer.id);
  transfersLookupTable.erc20Transfers = erc20Transfers;
  transfersLookupTable.save();

  // Update and save the Application
  application.nextERC20TransferID = application.nextERC20TransferID.plus(BigInt.fromI32(1));

  // Register the transfersLookupTable if we just created it
  if (transfersLookupTableCreated) {
    let transfersLookupTablesToProcess = application.transfersLookupTablesToProcess;
    transfersLookupTablesToProcess.push(transfersLookupTable.id);
    application.transfersLookupTablesToProcess = transfersLookupTablesToProcess;
  }
  application.save();
}