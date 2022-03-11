const fs = require("fs");
const writeYamlFile = require("write-yaml-file");

const commentTag = "__comments";

let constants = {};
let monitoredERC721 = [];
let paymentTokens = [];

// STEP 1: Build the subgraph.yaml file
function createDataSource(contractName, contractAddress, startBlock, isErc721) {
    let dataSource = {
        kind: "ethereum",
        name: contractName,
        network: "mainnet",
        source: {
            address: contractAddress,
            abi: isErc721 ? "ERC721" : "ERC20",
            startBlock: startBlock
        },
        mapping: {
            kind: "ethereum/events",
            apiVersion: "0.0.5",
            language: "wasm/assemblyscript",
            entities: [
                "Application",
                "ERC20Transfer",
                "ERC721Transfer",
                "TransfersLookupTable",
                "NFTSale",
            ],
            abis: [{
                name: isErc721 ? "ERC721" : "ERC20",
                file: isErc721 ? "./abis/ERC721.json" : "./abis/ERC20.json",
            }],
            eventHandlers: [{
                event: isErc721 ? "Transfer(indexed address,indexed address,indexed uint256)" : "Transfer(indexed address,indexed address,uint256)",
                handler: isErc721 ? "handleERC721Transfer" : "handleERC20Transfer"
            }],
            file: isErc721 ? "./src/erc721_mapping.ts" : "./src/erc20_mapping.ts"
        }
    };

    if (isErc721) {
        dataSource.mapping["blockHandlers"] = [{
            handler: "handleBlock"
        }];
    }

    return dataSource;
}

let subgraphYamlDoc = {
    specVersion: "0.0.2",
    schema: {
        file: "./schema.graphql"
    },
    dataSources: []
};

// Load the config
let config = JSON.parse(fs.readFileSync("./bootstrap/config.json").toString());

// Loop over the ERC721 contracts
let minStartBlock = -1;
let erc721configs = config["ERC721"];
for (const erc721ContractName in erc721configs) {
    if (erc721ContractName == commentTag) continue;

    let erc721ContractConfig = erc721configs[erc721ContractName];
    let startBlock = erc721ContractConfig["startBlock"];
    let address = erc721ContractConfig["address"];

    // Add the datasource
    subgraphYamlDoc["dataSources"].push(createDataSource(
        erc721ContractName,
        address,
        startBlock,
        true
    ));

    // Register the min start block number tha will be sued for ERC20 contraxt later
    if (minStartBlock == -1 || startBlock < minStartBlock) {
        minStartBlock = startBlock;
    }

    // Register the constant
    constants[erc721ContractName] = address.toLowerCase();

    // Register the nftName
    monitoredERC721.push(erc721ContractName)
}

// Loop over the payment tokens contracts
let paymentTokensconfigs = config["PAYMENT_TOKENS"];
for (const paymentTokenName in paymentTokensconfigs) {
    if (paymentTokenName == commentTag) continue;

    let address = paymentTokensconfigs[paymentTokenName];

    // Do not add a ERC20 contract for native ETH
    if (paymentTokenName !== "ETH") {
        // Add the datasource
        subgraphYamlDoc["dataSources"].push(createDataSource(
            paymentTokenName,
            address,
            minStartBlock,
            false
        ));
    }

    // Register the constant
    constants[paymentTokenName] = address.toLowerCase();

    // Register the nftName
    paymentTokens.push(paymentTokenName)
}

writeYamlFile("subgraph.yaml", subgraphYamlDoc).then(() => { });


// STEP 2.1: Add the MonitoredERC20 enum in the schema.graphql
let schemaContent = fs.readFileSync("./bootstrap/templates/schema.template.graphql");
let enumString = "";
for (const paymentToken of paymentTokens) {
    enumString = enumString.concat(paymentToken.concat("\n\t"));
}
enumString = enumString.concat("UNKNOWN");
schemaContent = schemaContent.toString().replace("$PAYMENT_TOKENS$", enumString);

// STEP 2.2: Add the MonitoredERC721 enum in the schema.graphql
enumString = "";
for (const erc721Name of monitoredERC721) {
    enumString = enumString.concat(erc721Name.concat("\n\t"));
}
enumString = enumString.concat("UNKNOWN");
schemaContent = schemaContent.toString().replace("$MONITORED_ERC721$", enumString);
fs.writeFileSync("./schema.graphql", schemaContent);


// STEP 3: Export the constants in contract_addresses.ts
let constantsTemplate = fs.readFileSync("./bootstrap/templates/contract_addresses.template.ts");
let constantString = "";
for (const constant in constants) {
    const constantValue = constants[constant];
    constantString = constantString.concat(constantsTemplate.toString().replace("$CONST_NAME$", constant).replace("$CONST_VALUE$", constantValue));
}
fs.writeFileSync("./src/contract_addresses.ts", constantString);


// STEP 4.1: Import the constants in utils.ts
let utilsContent = fs.readFileSync("./bootstrap/templates/utils.template.ts");
let importString = "";
for (const constant in constants) {
    importString = importString.concat(constant.concat(", "));
}
utilsContent = utilsContent.toString().replace("$CONSTANTS_IMPORT$", importString)

// STEP 4.2: Fill the addressToContractName function in utils.ts 
let mappingTemplate = `if (contract == $1) return "$2";`;
let mappingString = "";
for (const constant in constants) {
    mappingString = mappingString.concat(mappingTemplate.toString().replace("$1", constant).replace("$2", constant).concat("\n\t"));
}
mappingString = mappingString.concat(`return "UNKNOWN";`)
utilsContent = utilsContent.toString().replace("$CONTRACT_MAP$", mappingString);
fs.writeFileSync("./src/utils.ts", utilsContent);

// STEP 5: Specify the ERC721 contract in the import of the erc721_mapping.ts
let erc721_mapping_content = fs.readFileSync("./bootstrap/templates/erc721_mapping.template.ts");
erc721_mapping_content = erc721_mapping_content.toString().replace("$ERC721_CONTRACT$", monitoredERC721[0]);
fs.writeFileSync("./src/erc721_mapping.ts", erc721_mapping_content);

// STEP 6: Specify the ERC20 contract in the import of the erc20_mapping.ts
let erc20_mapping_content = fs.readFileSync("./bootstrap/templates/erc20_mapping.template.ts");
erc20_contract = paymentTokens.find(e => e.toLowerCase() !== "eth");
erc20_mapping_content = erc20_mapping_content.toString().replace("$ERC20_CONTRACT$", erc20_contract);
fs.writeFileSync("./src/erc20_mapping.ts", erc20_mapping_content);


// STEP 7: DONE
console.log(`
    Bootstrap done !
    Your subgraph will be indexing all sales on either of:
        MONITORED_ERC721
    Paid with either of:
        PAYMENT_TOKENS

    You can now deploy your subgraph and start indexing :)
    Run: 
        graph deploy --studio <your_sub_graph_slug>
                    OR
        graph deploy --hosted <your_sub_graph_slug>
`.replace("MONITORED_ERC721", monitoredERC721.join(', ')).replace("PAYMENT_TOKENS", paymentTokens.join(', ')));