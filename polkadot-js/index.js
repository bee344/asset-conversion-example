const { Keyring } = require("@polkadot/keyring");
const { ApiPromise, WsProvider } = require("@polkadot/api");
const { cryptoWaitReady } = require("@polkadot/util-crypto");

async function main() {

    const apiConfigRuntime = {
        spec: {
            westmint: {
                runtime: {
                    AssetConversionApi: [
                        {
                            methods: {
                                quote_price_exact_tokens_for_tokens: {
                                    description: 'Quote price: exact tokens for tokens',
                                    params: [
                                        {
                                            name: 'asset1',
                                            type: 'MultiLocation',
                                        },
                                        {
                                            name: 'asset2',
                                            type: 'MultiLocation',
                                        },
                                        {
                                            name: 'amount',
                                            type: 'u128',
                                        },
                                        {
                                            name: 'include_fee',
                                            type: 'bool',
                                        },
                                    ],
                                    type: 'Option<(Balance)>',
                                },
                            },
                            version: 1,
                        },
                    ],
                },
            },
        },
    };

    /**
     * Here we define the main aspects of our custom asset
     */
    const ASSET_ID = 1;
    const ASSET_NAME = "Testy";
    const ASSET_TICKER = "TSTY";
    const ASSET_DECIMALS = 0;
    const ASSET_MIN = 1;

    /**
     * Now we set our local Westend Asset Hub node as the wsProvider 
     */
    const wsProvider = new WsProvider("ws://127.0.0.1:9944");

    /**
     * We use the wsProvider defined above to create the ApiPromise.
     * We also use the opportunity to inject the [`ChargeAssetTxPayment`]
     * signed extension as defined in the pallet-asset-conversion-tx-payment.
     * We do this in order to support passing a MultiLocation as the assetId to
     * use a custom asset to pay for the fees.
     */
    const api = await ApiPromise.create({
        provider: wsProvider,
        typesBundle: apiConfigRuntime,
        signedExtensions: {
            ChargeAssetTxPayment: {
                extrinsic: {
                    tip: 'Compact<Balance>',
                    assetId: 'Option<MultiLocation>'
                },
                payload: {}
            },
        },
    },
    );

    /**
     * We wait for the api to be ready and for the underlying WASM libraries to 
     * have been made available.
     */
    await api.isReady;
    await cryptoWaitReady();

    /**
     * Here we define a new Keyring and add Alice's and Bob's keypairs to it.
     */
    const keyring = new Keyring({ type: "sr25519" });
    const alice = keyring.addFromUri("//Alice");
    const bob = keyring.addFromUri("//Bob");

    /**
     * We define our custom asset's MultiLocation and create it. We will need it
     * for managing the liquidity pool and to pass it as the assetId to pay for
     * the tx fees.
     */
    const asset = {
        parents: 0,
        interior: {
            X2: [
                { palletInstance: 50 },
                { generalIndex: ASSET_ID },
            ]
        }

    };

    /**
     * We create the native asset's MultiLocation, we will need it for managing
     * the liquidity pool.
     */
    const native = {
        parents: 1,
        interior: {
            Here: '',
        },
    };

    /**
     * Here we define an empty array to collect the txs necessary for creating 
     * the asset, setting its metadata, minting some to Alice, and setting up 
     * the liquidity pool, as well as those calls.
     */
    const setupTxs = [];
    const create = api.tx.assets.create(ASSET_ID, alice.address, ASSET_MIN);
    const setMetadata = api.tx.assets.setMetadata(ASSET_ID, ASSET_NAME, ASSET_TICKER, ASSET_DECIMALS);
    const mint = api.tx.assets.mint(ASSET_ID, alice.address, 100000000);
    const createPool = api.tx.assetConversion.createPool(native, asset);
    const addLiquidity = api.tx.assetConversion.addLiquidity(native, asset, 1000000000000, 500000, 0, 0, alice.address);

    /**
     * We then push the calls to the array.
     */
    setupTxs.push(create);
    setupTxs.push(setMetadata);
    setupTxs.push(mint);
    setupTxs.push(createPool);
    setupTxs.push(addLiquidity);

    /**
     * We send the calls as a batch, and watch its status to check when it's
     * finalized or if it throws an error, in which case we lookup what the 
     * error was and log it.
     */
    await api.tx.utility.batchAll(setupTxs).signAndSend(alice);
    console.log(`\nSending batch call`);

    /**
     * We wait for some time to pass in order to let the pool get created
     * correctly and the liquidity tokens credited to Alice.
     */
    await timeout(24000);

    /**
     * Now that the liquidity pool is in place and it has liquidity, we can
     * estimate the fees of the transfer in the native asset.
     */
    const transferInfo = await api.tx.balances.transferKeepAlive(bob.address, 2000000).paymentInfo(alice);
    console.log(`\nThe estimated fee in the native asset is: ${transferInfo.partialFee.toHuman()}`);

    /**
     * And with the AssetConversionApi we can get a quote of how much are the fees
     * in the custom asset. 
     */
    const convertedFee = await api.call.assetConversionApi.quotePriceExactTokensForTokens(native, asset, transferInfo.partialFee, true);
    console.log(`\nThe estimated fee converted to the custom asset is: ${convertedFee.toString()} ${ASSET_TICKER}`);

    /**
     * Now we just send a regular transfer specifying the
     * custom asset's MultiLocation as the assetId to pay for the fees.
     */
    await api.tx.balances
        .transferKeepAlive(bob.address, 2000000)
        .signAndSend(alice, { assetId: asset });

    console.log(`\nTransaction successful`);
}

async function timeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
    .catch(console.error)
    .finally(() => process.exit());
