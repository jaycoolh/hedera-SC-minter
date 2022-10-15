const {
	Client,
	AccountId,
	PrivateKey,
	AccountCreateTransaction,
	Hbar,
	ContractCreateFlow,
	AccountInfoQuery,
	TransferTransaction,
	ContractInfoQuery,
	ContractFunctionParameters,
	HbarUnit,
	ContractExecuteTransaction,
	TokenId,
	ContractId,
	ContractCallQuery,
} = require('@hashgraph/sdk');
const fs = require('fs');
const Web3 = require('web3');
const web3 = new Web3();
const { expect } = require('chai');
const { describe, it } = require('mocha');

require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = 'MinterContract';
const env = process.env.ENVIRONMENT ?? null;
const lazyContractId = ContractId.fromString(process.env.LAZY_CONTRACT);
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN);
const lazyBurnPerc = process.env.LAZY_BURN_PERC || 25;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variable
let contractId;
let contractAddress;
let abi;
let client;
let alicePK, aliceId;
let tokenId;

describe('Deployment: ', function() {
	it('Should deploy the contract and setup conditions', async function() {
		if (contractName === undefined || contractName == null) {
			console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
			process.exit(1);
		}
		if (operatorKey === undefined || operatorKey == null || operatorId === undefined || operatorId == null) {
			console.log('Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		// import ABI
		abi = json.abi;

		const contractBytecode = json.bytecode;
		const gasLimit = 1200000;

		console.log('\n- Deploying contract...', contractName, '\n\tgas@', gasLimit);

		await contractDeployFcn(contractBytecode, gasLimit);

		console.log(`Contract created with ID: ${contractId} / ${contractAddress}`);

		console.log('\n-Testing:', contractName);

		// create Alice account
		alicePK = PrivateKey.generateED25519();
		aliceId = await accountCreator(alicePK, 10);
		console.log('Alice account ID:', aliceId.toString(), '\nkey:', alicePK.toString());

		it('Ensure Alice is a little LAZY (send some to prime the pumps)', async function() {
			// send 1 $LAZY
			const result = await ftTansferFcn(operatorId, aliceId, 10, lazyTokenId);
			expect(result).to.be.equal('SUCCESS');
		});

		expect(contractId.toString().match(addressRegex).length == 2).to.be.true;
	});
});

describe('Check SC deployment...', function() {
	it('Check Lazy token was associated by constructor', async function() {
		client.setOperator(operatorId, operatorKey);
		const [contractLazyBal] = await getContractBalance(contractId);
		expect(contractLazyBal == 0).to.be.true;
	});

	it('Check linkage to Lazy token / LSCT is correct', async function() {
		const addressLSCT = await getSetting('getLSCT', 'lsct');
		expect(ContractId.fromSolidityAddress(addressLSCT).toString() == lazyContractId.toString()).to.be.true;

		const addressLazy = await getSetting('getLazyToken', 'lazy');
		expect(TokenId.fromSolidityAddress(addressLazy).toString() == lazyTokenId.toString()).to.be.true;
	});

	it('Check default values are set in Constructor', async function() {
		const paused = await getSetting('getMintPaused', 'paused');
		expect(paused).to.be.true;
		const lazyFromSC = await getSetting('getPayLazyFromSC', 'payFromSC');
		expect(lazyFromSC).to.be.false;
		const priceHbar = await getSetting('getBasePriceHbar', 'priceHbar');
		expect(Number(priceHbar) == 0).to.be.true;
		const priceLazy = await getSetting('getBasePriceLazy', 'priceLazy');
		expect(Number(priceLazy) == 0).to.be.true;
		const wlDisc = await getSetting('getWLDiscount', 'wlDiscount');
		expect(Number(wlDisc) == 0).to.be.true;
		const lastMint = await getSetting('getLastMint', 'lastMintTime');
		expect(Number(lastMint) == 0).to.be.true;
		const mintStart = await getSetting('getMintStartTime', 'mintStartTime');
		expect(Number(mintStart) == 0).to.be.true;
		const maxMint = await getSetting('getMaxMint', 'maxMint');
		expect(Number(maxMint) == 0).to.be.true;
		const cooldown = await getSetting('getCooldownPeriod', 'cooldownPeriod');
		expect(Number(cooldown) == 0).to.be.true;
		const lazyBurn = await getSetting('getLazyBurnPercentage', 'lazyBurn');
		expect(Number(lazyBurn) == lazyBurnPerc).to.be.true;
	});

	// initialize the minter!

});

describe('Check access control permission...', function() {
	it('Check Alice cannot modify LAZY token ID', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterAddress('updateLazyToken', TokenId.fromString('0.0.48486075'));
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify LSCT', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterAddress('updateLSCT', ContractId.fromString('0.0.48627791'));
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the WL', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterAddress('addToWhitelist', aliceId);
		}
		catch (err) {
			errorCount++;
		}

		try {
			await useSetterAddress('removeFromWhitelist', aliceId);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});

	it('Check Alice cannot modify the CID/metadata', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterString('updateCID', 'newCIDstring');
		}
		catch (err) {
			errorCount++;
		}

		try {
			await useSetterStringArray('updateMetadataArray', ['meta1', 'meta2']);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(2);
	});

	it('Check Alice cannot retrieve the unminted metadata', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await getSetting('getMetadataArray', 'metadataList');
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the cost', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateCost', 1, 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the Lazy Burn Precentage', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateLazyBurnPercentage', 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the max mint', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateMaxMint', 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the cooldown timer', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateCost', 1, 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the start date', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			await useSetterInts('updateMintStartDate', (new Date().getTime() / 1000) + 30);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify the pause status', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterBool('updatePauseStatus', false);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannot modify flag to spend lazy from contract', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await useSetterBool('updatePauseStatus', false);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});
});

describe('Basic interaction with the Minter...', function() {
	it('Mint a token from the SC for hbar', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Mint a token from the SC for Lazy', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Mint a token from the SC for hbar + Lazy', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check unable to mint if not enough funds', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check unable to mint if contract paused', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check unable to mint if not yet at start time', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check **ABLE** to mint once start time has passed', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check concurrent mint...', async function() {
		// Operator & Alice mint 10 in 1 per tx loop
		expect.fail(0, 1, 'Not implemented');
	});
});

describe('Update parameters for the Minter...', function() {
	it('Owner can get metadata', async function() {
		client.setOperator(operatorId, operatorKey);
		expect.fail(0, 1, 'Not implemented');
	});

	it('Fail to update metadata to wrong size', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Successfully update metadata', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Successfully update CID', async function() {
		expect.fail(0, 1, 'Not implemented');
	});
});

describe('Test out WL functions...', function() {
	it('Enable WL, check WL empty', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check Alice is unable to mint ', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Add Alice to WL & can mint', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Remove Alice from WL, let Alice buy in with Lazy', async function() {
		expect.fail(0, 1, 'Not implemented');
	});
});

describe('Test out Discount mint functions...', function() {
	it('getCost method to check discount / non-discount cost', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Set discounts at token level, mint at discount price', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Set discount for WL mint, mint with WL', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Ensure non-WL has correct price for mint', async function() {
		expect.fail(0, 1, 'Not implemented');
	});
});

describe('Test out refund functions...', function() {
	it('Enable refund (& burn), mint then refund - hbar', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Enable refund (& burn), mint then refund - lazy', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Shift to refund (hbar & lazy) but store NFT on refund', async function() {
		expect.fail(0, 1, 'Not implemented');
	});

	it('Check Owner can withdraw NFTs exchanged for refund', async function() {
		expect.fail(0, 1, 'Not implemented');
	});
});

describe('Withdrawal tests...', function() {
	it('Check Alice cannnot withdraw hbar', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// using a dummy value [check onece testnet resets if still passes]
			await transferHbarFromContract(0.1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Alice cannnot withdraw Lazy', async function() {
		client.setOperator(aliceId, alicePK);
		let errorCount = 0;
		try {
			// try requesting a min lot
			await transferFungibleWithHTS(aliceId, 1);
		}
		catch (err) {
			errorCount++;
		}
		expect(errorCount).to.be.equal(1);
	});

	it('Check Owner cannot pull funds before X time has elapsed from last mint', async function() {
		client.setOperator(operatorId, operatorKey);
		// set refund window timing & mint
		expect.fail(0, 1, 'Not implemented');
		// withdrawl of funds should be blocked

		// sleep the required time to ensure next pull should work.
		await sleep(10);
	});

	it('Check Owner can pull hbar & Lazy', async function() {
		client.setOperator(operatorId, operatorKey);
		let [contractLazyBal, contractHbarBal] = await getContractBalance(contractId);
		const result = await transferHbarFromContract(Number(contractHbarBal.toTinybars()), HbarUnit.Tinybar);
		console.log('Clean-up -> Retrieve hbar from Contract');
		[contractLazyBal, contractHbarBal] = await getContractBalance(contractId);
		console.log('Contract ending hbar balance:', contractHbarBal.toString());
		console.log('Contract ending Lazy balance:', contractLazyBal.toString());
		expect(result).to.be.equal('SUCCESS');
	});

	it('Cleans up -> retrieve hbar/Lazy', async function() {
		// get Alice balance
		const [aliceLazyBal, aliceHbarBal] = await getAccountBalance(aliceId);
		// SDK transfer back to operator
		client.setOperator(aliceId, alicePK);
		if (aliceLazyBal > 0) {
			const lazyReceipt = await ftTansferFcn(aliceId, operatorId, aliceLazyBal, lazyTokenId);
			expect(lazyReceipt == 'SUCCESS').to.be.true;
		}
		const receipt = await hbarTransferFcn(aliceId, operatorId, aliceHbarBal.toBigNumber().minus(0.01));
		console.log('Clean-up -> Retrieve hbar/Lazy from Alice');
		expect(receipt == 'SUCCESS').to.be.true;
	});
});

/**
 * Helper function to get the current settings of the contract
 * @param {string} fcnName the name of the getter to call
 * @param {string} expectedVar the variable to exeppect to get back
 * @return {[string , string]} The LSCT address & the Lazy Token address in soloidity format
 */
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
 * Helper method to encode a contract query function
 * @param {string} functionName name of the function to call
 * @param {string[]} parameters string[] of parameters - typically blank
 * @returns {Buffer} encoded function call
 */
function encodeFunctionCall(functionName, parameters) {
	const functionAbi = abi.find((func) => func.name === functionName && func.type === 'function');
	const encodedParametersHex = web3.eth.abi.encodeFunctionCall(functionAbi, parameters).slice(2);
	return Buffer.from(encodedParametersHex, 'hex');
}

/**
 * Helper function for FT transfer
 * @param {AccountId} sender
 * @param {AccountId} receiver
 * @param {Number} amount
 * @param {TokenId} token
 * @returns {TransactionReceipt | any}
 */
async function ftTansferFcn(sender, receiver, amount, token) {
	const transferTx = new TransferTransaction()
		.addTokenTransfer(token, sender, -amount)
		.addTokenTransfer(token, receiver, amount)
		.freezeWith(client);
	const transferSign = await transferTx.sign(operatorKey);
	const transferSubmit = await transferSign.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/**
 * Request hbar from the contract
 * @param {number} amount
 * @param {HbarUnit=} units defaults to Hbar as the unit type
 */
async function transferHbarFromContract(amount, units = HbarUnit.Hbar) {
	const gasLim = 400000;
	const params = new ContractFunctionParameters()
		.addAddress(operatorId.toSolidityAddress())
		.addUint256(new Hbar(amount, units).toTinybars());
	const [callHbarRx, , ] = await contractExecuteFcn(contractId, gasLim, 'transferHbar', params);
	return callHbarRx.status.toString();
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

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {boolean} value
 * @returns {string}
 */
async function useSetterBool(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addBool(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {TokenId | AccountId | ContractId} value
 * @returns {string}
 */
async function useSetterAddress(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addAddress(value.toSolidityAddress());
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string} value
 * @returns {string}
 */
async function useSetterString(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addString(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {string[]} value
 * @returns {string}
 */
async function useSetterStringArray(fcnName, value) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters()
		.addStringArray(value);
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Generic setter caller
 * @param {string} fcnName
 * @param {...number} values
 * @returns {string}
 */
async function useSetterInts(fcnName, ...values) {
	const gasLim = 200000;
	const params = new ContractFunctionParameters();

	for (let i = 0 ; i < values.length; i++) {
		params.addUint256(values[i]);
	}
	const [setterAddressRx, , ] = await contractExecuteFcn(contractId, gasLim, fcnName, params);
	return setterAddressRx.status.toString();
}

/**
 * Helper function to get the Lazy, hbar & minted NFT balance of the contract
 * @returns {[number | Long.Long, Hbar, number | Long.Long]} The balance of the FT (without decimals), Hbar & NFT at the SC
 */
async function getContractBalance() {

	const query = new ContractInfoQuery()
		.setContractId(contractId);

	const info = await query.execute(client);

	let balance;

	const tokenMap = info.tokenRelationships;
	const tokenBal = tokenMap.get(lazyTokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	let nftBal = 0;
	if (tokenId) {
		const nftTokenBal = tokenMap.get(tokenId.toString());
		if (nftTokenBal) {
			nftBal = nftTokenBal.balance;
		}
		else {
			nftBal = -1;
		}
	}

	return [balance, info.balance, nftBal];
}


/**
 * Helper function to send hbar
 * @param {AccountId} sender sender address
 * @param {AccountId} receiver receiver address
 * @param {string | number | BigNumber} amount the amounbt to send
 * @returns {any} expect a string of SUCCESS
 */
async function hbarTransferFcn(sender, receiver, amount) {
	const transferTx = new TransferTransaction()
		.addHbarTransfer(sender, -amount)
		.addHbarTransfer(receiver, amount)
		.freezeWith(client);
	const transferSubmit = await transferTx.execute(client);
	const transferRx = await transferSubmit.getReceipt(client);
	return transferRx.status.toString();
}

/**
 * Helper function to retrieve account balances
 * @param {AccountId} acctId the account to check
 * @returns {[number, Hbar, number]} balance of the FT token (without decimals), balance of Hbar & NFTs in account as array
 */
async function getAccountBalance(acctId) {

	const query = new AccountInfoQuery()
		.setAccountId(acctId);

	const info = await query.execute(client);

	let balance;
	const tokenMap = info.tokenRelationships;
	// This is in process of deprecation sadly so may need to be adjusted.
	const tokenBal = tokenMap.get(lazyTokenId.toString());
	if (tokenBal) {
		balance = tokenBal.balance;
	}
	else {
		balance = -1;
	}

	let nftBal = 0;
	if (tokenId) {
		const nftTokenBal = tokenMap.get(tokenId.toString());
		if (nftTokenBal) {
			nftBal = nftTokenBal.balance;
		}
		else {
			nftBal = -1;
		}
	}

	return [balance, info.balance, nftBal];
}

/**
 * Helper function to create new accounts
 * @param {PrivateKey} privateKey new accounts private key
 * @param {string | number} initialBalance initial balance in hbar
 * @returns {AccountId} the nrewly created Account ID object
 */
async function accountCreator(privateKey, initialBalance) {
	const response = await new AccountCreateTransaction()
		.setInitialBalance(new Hbar(initialBalance))
		.setMaxAutomaticTokenAssociations(10)
		.setKey(privateKey.publicKey)
		.execute(client);
	const receipt = await response.getReceipt(client);
	return receipt.accountId;
}

/**
 * Helper function to deploy the contract
 * @param {string} bytecode bytecode from compiled SOL file
 * @param {number} gasLim gas limit as a number
 */
async function contractDeployFcn(bytecode, gasLim) {
	const contractCreateTx = new ContractCreateFlow()
		.setBytecode(bytecode)
		.setGas(gasLim)
		.setConstructorParameters(
			new ContractFunctionParameters()
				.addAddress(lazyContractId.toSolidityAddress())
				.addAddress(lazyTokenId.toSolidityAddress())
				.addUint256(lazyBurnPerc),
		);
	const contractCreateSubmit = await contractCreateTx.execute(client);
	const contractCreateRx = await contractCreateSubmit.getReceipt(client);
	contractId = contractCreateRx.contractId;
	contractAddress = contractId.toSolidityAddress();
}

/**
 * basci sleep function
 * @param {number} ms milliseconds to sleep
 * @returns {Promise}
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper method to transfer FT using HTS
 * @param {AccountId} receiver
 * @param {number} amount amount of the FT to transfer (adjusted for decimal)
 * @returns {any} expected to be a string 'SUCCESS' implies it worked
 */
async function transferFungibleWithHTS(receiver, amount) {

	const gasLim = 600000;
	const params = new ContractFunctionParameters()
		.addAddress(lazyTokenId.toSolidityAddress())
		.addAddress(receiver.toSolidityAddress())
		.addInt64(amount);
	const [tokenTransferRx, , ] = await contractExecuteFcn(contractId, gasLim, 'transferHTS', params);
	const tokenTransferStatus = tokenTransferRx.status;

	return tokenTransferStatus.toString();
}