const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
	ContractExecuteTransaction,
	ContractCallQuery,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
require('dotenv').config();
const readlineSync = require('readline-sync');
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
let abi;

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;
const MINT_PAYMENT = process.env.MINT_PAYMENT || 50;

const contractId = ContractId.fromString(process.env.CONTRACT_ID);

const env = process.env.ENVIRONMENT ?? null;
let client;

// check-out the deployed script - test read-only method
const main = async () => {
	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}


	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('interacting in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('interacting in *MAINNET*');
	}
	else {
		console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
		return;
	}

	client.setOperator(operatorId, operatorKey);

	// import ABI
	const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`, 'utf8'));
	abi = json.abi;
	console.log('\n -Loading ABI...\n');

	console.log('Using contract:', contractId.toString());

	const proceed = readlineSync.keyInYNStrict('Do you wish to reset contract, upload new metadata and create a new token?');
	if (proceed) {

		await methodCallerNoArgs('resetToken', 500000);
		const metadataList = [];

		// 23 * 444 = 10,212 for testing!
		for (let outer = 0; outer < 23; outer++) {
			for (let m = 1; m <= 444; m++) {
				const num = '' + m;
				metadataList.push(num.padStart(3, '0') + '_metadata.json');
			}
		}

		await uploadMetadata(metadataList);

		const royalty1 = new NFTFeeObject(200, 10000, operatorId.toSolidityAddress(), 5);

		const royaltyList = [royalty1];

		const [, tokenAddressSolidity] = await initialiseNFTMint(
			'MC-test',
			'MCt',
			'MC testing memo',
			'ipfs://bafybeibiedkt2qoulkexsl2nyz5vykgyjapc5td2fni322q6bzeogbp5ge/',
			royaltyList,
		);
		const tokenId = TokenId.fromSolidityAddress(tokenAddressSolidity);
		console.log('Token Created:', tokenId.toString(), ' / ', tokenAddressSolidity);

	}
	else {
		console.log('User aborted.');
	}
};

/**
 * Call a methos with no arguments
 * @param {string} fcnName
 * @param {number=} gas
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function methodCallerNoArgs(fcnName, gasLim = 500000) {
	const params = new ContractFunctionParameters();
	const [setterAddressRx, setterResults ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 *
 * @param {string} name
 * @param {string} symbol
 * @param {string} memo
 * @param {string} cid
 * @param {*} royaltyList
 */
async function initialiseNFTMint(name, symbol, memo, cid, royaltyList, gasLim = 1000000) {
	const params = [name, symbol, memo, cid, royaltyList];

	const [initialiseRx, initialiseResults] = await contractExecuteWithStructArgs(contractId, gasLim, 'initialiseNFTMint', params, MINT_PAYMENT);
	return [initialiseRx.status.toString(), initialiseResults['createdTokenAddress'], initialiseResults['maxSupply']] ;
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVar the variable to exeppect to get back
 * @return {*}
 */
// eslint-disable-next-line no-unused-vars
async function getSetting(fcnName, expectedVar) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100000)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	return queryResult[expectedVar];
}

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVars the variable to exeppect to get back
 * @return {*} array of results
 */
// eslint-disable-next-line no-unused-vars
async function getSettings(fcnName, ...expectedVars) {
	// check the Lazy Token and LSCT addresses
	// generate function call with function name and parameters
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, []);

	// query the contract
	const contractCall = await new ContractCallQuery()
		.setContractId(contractId)
		.setFunctionParameters(functionCallAsUint8Array)
		.setMaxQueryPayment(new Hbar(2))
		.setGas(100000)
		.execute(client);
	const queryResult = await decodeFunctionResult(fcnName, contractCall.bytes);
	const results = [];
	for (let v = 0 ; v < expectedVars.length; v++) {
		results.push(queryResult[expectedVars[v]]);
	}
	return results;
}

async function contractExecuteWithStructArgs(cId, gasLim, fcnName, params, amountHbar) {
	// use web3.eth.abi to encode the struct for sending.
	// console.log('pre-encode:', JSON.stringify(params, null, 4));
	const functionCallAsUint8Array = await encodeFunctionCall(fcnName, params);

	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunctionParameters(functionCallAsUint8Array)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults, record];
}

/**
 * Decodes the result of a contract's function execution
 * @param functionName the name of the function within the ABI
 * @param resultAsBytes a byte array containing the execution result
 */
function decodeFunctionResult(functionName, resultAsBytes) {
	const functionAbi = abi.find(func => func.name === functionName);
	const functionParameters = functionAbi.outputs;
	const resultHex = '0x'.concat(Buffer.from(resultAsBytes).toString('hex'));
	const result = web3.eth.abi.decodeParameters(functionParameters, resultHex);
	return result;
}

function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Method top upload the metadata using chunking
 * @param {string[]} metadata
 * @return {[string, Number]}
 */
async function uploadMetadata(metadata) {
	const uploadBatchSize = 60;
	const gasLim = 1500000;
	let totalLoaded = 0;
	let result;
	for (let outer = 0; outer < metadata.length; outer += uploadBatchSize) {
		const dataToSend = [];
		for (let inner = 0; (inner < uploadBatchSize) && ((inner + outer) < metadata.length); inner++) {
			dataToSend.push(metadata[inner + outer]);
		}
		[, result] = await useSetterStringArray('addMetadata', dataToSend, gasLim);
		totalLoaded = Number(result['totalLoaded']);
		console.log('Uploaded metadata:', totalLoaded);
	}
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string[]} value
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
async function useSetterStringArray(fcnName, value, gasLim = 200000) {
	const params = new ContractFunctionParameters()
		.addStringArray(value);
	const [setterAddressRx, setterResults] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return [setterAddressRx.status.toString(), setterResults];
}

/**
 * Helper function for calling the contract methods
 * @param {ContractId} cId the contract to call
 * @param {number | Long.Long} gasLim the max gas
 * @param {string} fcnName name of the function to call
 * @param {ContractFunctionParameters} params the function arguments
 * @param {string | number | Hbar | Long.Long | BigNumber} amountHbar the amount of hbar to send in the methos call
 * @returns {[TransactionReceipt, any, TransactionRecord]} the transaction receipt and any decoded results
 */
async function contractExecuteFcn(cId, gasLim, fcnName, params, amountHbar) {
	const contractExecuteTx = await new ContractExecuteTransaction()
		.setContractId(cId)
		.setGas(gasLim)
		.setFunction(fcnName, params)
		.setPayableAmount(amountHbar)
		.execute(client);

	// get the results of the function call;
	const record = await contractExecuteTx.getRecord(client);
	const contractResults = decodeFunctionResult(fcnName, record.contractFunctionResult.bytes);
	const contractExecuteRx = await contractExecuteTx.getReceipt(client);
	return [contractExecuteRx, contractResults, record];
}

class NFTFeeObject {
	/**
	 *
	 * @param {number} numerator
	 * @param {number} denominator
	 * @param {string} account address in solidity format
	 * @param {number} fallbackfee left as 0 if no fallback
	 */
	constructor(numerator, denominator, account, fallbackfee = 0) {
		this.numerator = numerator;
		this.denominator = denominator;
		this.fallbackfee = fallbackfee;
		this.account = account;
	}
}

main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});