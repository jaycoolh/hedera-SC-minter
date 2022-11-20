const {
	Client,
	AccountId,
	PrivateKey,
	FileCreateTransaction,
	FileAppendTransaction,
	Hbar,
	FileContentsQuery,
	FileId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
require('dotenv').config();

// Get operator from .env file
const operatorKey = PrivateKey.fromString(process.env.PRIVATE_KEY);
const operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
const contractName = process.env.CONTRACT_NAME ?? null;

const env = process.env.ENVIRONMENT ?? null;

let client;

async function loadBytecodeToHedera(bytecode) {
	// Create a file on Hedera and store the hex-encoded bytecode
	const fileCreateTx = new FileCreateTransaction().setKeys([operatorKey]);
	const fileSubmit = await fileCreateTx.execute(client);
	const fileCreateRx = await fileSubmit.getReceipt(client);
	const bytecodeFileId = fileCreateRx.fileId;
	console.log(`- The smart contract bytecode file ID is: ${bytecodeFileId}`);

	// Append contents to the file
	const fileAppendTx = new FileAppendTransaction()
		.setFileId(bytecodeFileId)
		.setContents(bytecode)
		.setMaxAttempts(20)
		.setMaxChunks(20)
		.setMaxTransactionFee(new Hbar(5));
	const fileAppendSubmit = await fileAppendTx.execute(client);
	const fileAppendRx = await fileAppendSubmit.getReceipt(client);
	console.log(`- Content added: ${fileAppendRx.status} \n`);

}

async function viewFileContents(bytecodeFileId) {
	// Create the query
	const query = new FileContentsQuery()
		.setFileId(bytecodeFileId);

	// Sign with client operator private key and submit the query to a Hedera network
	const contents = await query.execute(client);

	console.log(contents.toString());
}

const main = async () => {
	if (contractName === undefined || contractName == null) {
		console.log('Environment required, please specify CONTRACT_NAME for ABI in the .env file');
		return;
	}

	const args = process.argv.slice(2);

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());

	if (args.length == 1) {
		console.log('Examining file contents @:', args[0]);
		await viewFileContents(FileId.fromString(args[0]));
		return;
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to upload bytecode?');

	if (proceed) {
		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('deploying in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('deploying in *MAINNET*');
		}
		else {
			console.log('ERROR: Must specify either MAIN or TEST as environment in .env file');
			return;
		}

		client.setOperator(operatorId, operatorKey);

		const json = JSON.parse(fs.readFileSync(`./artifacts/contracts/${contractName}.sol/${contractName}.json`));

		const contractBytecode = json.bytecode;

		console.log('\n- Uploading bytecode...');

		await loadBytecodeToHedera(contractBytecode);
	}
	else {
		console.log('User aborted');
	}
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
