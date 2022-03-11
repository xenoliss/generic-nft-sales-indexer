# generic-nft-sales-indexer

This repository aims at helping developers to track NFT sales happening on the blockchain. Minimal configuration is required to deployed a subgraph tracking **any NFT sales on any marketplaces**.

The provided code contains:
- A configuration JSON file
- A bootstrap script to easily setup the subgraph according to your needs
- The subgraph code itself


# Get started

Pretty easy to get started:
1. Edit the configuration file located at `bootstrap/config.json`
2. Run the bootstrap script using `npm run bootstrap`
3. You are good to go and deploy the subgraph !

**PS**: Don't forget to do the usual `npm i` after cloning the repository

# Notes
The deployed subgraph is generic meaning:
-  **It indexes all sales made on the chosen NFT contracts**. And by all sales I mean really all (even the minting for instance).
- **It does not set the exact sale price in the NFTSale entity**. I guess it's close to impossible to do as of now while supporting every single marketplaces.

The reason for the 2nd point above is every marketplaces is handling ERC20 transfers differently. For instance:
- **OpenSea** is first transferring the whole sale price to their WyvernExchange and then splitting it between (between the seller wallet and the OpenSea fee wallet). The following transaction is an example of this: [https://etherscan.io/tx/0x33cc5f51d8c2da5b98af477ea60d40af6d5e6668a5493fa603472ec9e228dd11](https://etherscan.io/tx/0x33cc5f51d8c2da5b98af477ea60d40af6d5e6668a5493fa603472ec9e228dd11 "https://etherscan.io/tx/0x33cc5f51d8c2da5b98af477ea60d40af6d5e6668a5493fa603472ec9e228dd11"). 
- **LooksRare** is splitting the ERC20 transfers from the start. The tokens are not gathered on the exchange as with OpenSea but the buyer is directly sending a bit to the fee wallet, a bit to the royalties wallet and the left to the seller. The following transaction is an example of this: [https://etherscan.io/tx/0xa0ef1bb490f6ae59d9b0508e7a476f0093ee6617d0fffcb369abcb9a25ed9a0a](https://etherscan.io/tx/0xa0ef1bb490f6ae59d9b0508e7a476f0093ee6617d0fffcb369abcb9a25ed9a0a "https://etherscan.io/tx/0xa0ef1bb490f6ae59d9b0508e7a476f0093ee6617d0fffcb369abcb9a25ed9a0a"). 

Since there is no official way of doing handling ERC20 transfers and every marketplace is doing differently, the subgraph can't determine, from the ERC20 transfers it sees, how to compute the global price of the sale. On OpenSea the sale price would most likely be the highest ERC20 transfer of the transaction. On LooksRare the sale price would be the sum of all the ERC20 transfers in the transaction.

/!\ While not setting the sale price directly, the subgraph is still storing all the ERC20/ETH transfers that happened during the sale so that the sale price can be reconstructed later. To keep the subgraph flexible and generic this is the client script side responsibility to compute the sale price from the list of ERC20 transfers that happen for a given sale. Doing so will allow more flexibility (i.e if the marketplace migrate their contract, change their fees, or if you want to handle a new marketplace etc.) since only the client script will need to be modified, the subgraph can stay as is.

# Entities
Here is the list of entities used in the subgraph with a short description of what they are:
- `PaymentToken`: this an enum of the payment token names you are tracking sales for. This enum is generated during the *bootstrap* phase.

- `MonitoredERC721`: this an enum of the ERC721 (NFT) contract names you are tracking sales for. This enum is generated during the *bootstrap* phase.

- `Application`: This entity is a singleton, meaning there will always be one and only one application for the whole lifetime of the subgraph. Its role is to :
	- Track the next available ID for the `ERC20Transfer` entity
	- Track the next available ID for the `ERC721Transfer` entity
	- Keep a list of the transfers that happened and that need to be processes in order to determine if they correspond to an `NFTSale`
	
- `ERC20Transfer`: This entity is created each time a new ERC20 transfer event is raised from the monitored ERC20 contracts. The lifetime of this entity is short (they are constantly removed from the store) unless it is identified as an `NFTSale` during the *processing phase*.

- `ERC721Transfer`: This entity is created each time a new ERC721 (NFT) transfer event is raised from the monitored ERC721 contracts. The lifetime of this entity is short (they are constantly removed from the store) unless it is identified as an `NFTSale` during the *processing phase*.

- `TransfersLookupTable`: This entity is created once **per transaction** that triggered one of the event handlers of the subgraph (either the ERC20 handler or the ERC721 handler). Its role is to keep track of all the `ERC20Transfer`s and `ERC721Transfer`s that happened during a single transaction. The lifetime of this entity is short (they are constantly removed from the store) unless it is identified as an `NFTSale` during the *processing phase*.

- `NFTSale`: This entity is the actual NFT sale that is created during the *processing phase*. Once created this entity is never removed from the store and will remain available for the lifetime of the subgraph. An `NFTSale` regroups the following info:
	- The transaction hash when the NFT sale happened
	- The NFT buyer
	- The NFT seller
	- The ERC20 token used to pay
	- The associated `TransfersLookupTable` which in turn regroups the following info:
		- The block number
		- The block timestamp
		- The list of `ERC20Transfer` (i.e the WETH transfer from the buyer to the exchange, the fees transfer to the fee wallet, the royalties transfer to the artist etc.)
		- The list of `ERC721Transfer` (may be several NFT transferred in one single sale if it's a bundle sale)

As you can see the their is no "sale price" in the `NFTSale` for reasons we explained earlier but the list of all the `ERC20Transfer`s that is associated with it still allows you to compute the sale price once you know how the marketplace is handling those transfers (which can easily be implemented in the client script).