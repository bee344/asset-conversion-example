const { Keyring } = require("@polkadot/keyring");
const { ApiPromise, WsProvider } = require("@polkadot/api");
const { cryptoWaitReady } = require("@polkadot/util-crypto");
const { ExtDef } = require('@polkadot/api/types');

async function main() {
    const ASSET_ID = 1;
    const ASSET_NAME = "Testy";
    const ASSET_TICKER = "TSTY";
    const ASSET_DECIMALS = 0;
    const ASSET_MIN = 1;

    const wsProvider = new WsProvider("ws://127.0.0.1:9944");
    const api = await ApiPromise.create({
        provider: wsProvider,
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
    await api.isReady;
    await cryptoWaitReady();

    const keyring = new Keyring({ type: "sr25519" });
    const alice = keyring.addFromUri("//Alice");
    const bob = keyring.addFromUri("//Bob");

    const asset = api.registry.createType('MultiLocation', {
        parents: 0,
        interior: {
            X2: [
                { palletInstance: 50 },
                { generalIndex: ASSET_ID },
            ]
        }

    });

    const native = api.registry.createType('MultiLocation', {
        parents: 1,
        interior: {
            Here: '',
        },
    },
    );

    const setupTxs = [];

    const create = api.tx.assets.create(ASSET_ID, alice.address, ASSET_MIN);
    const setMetadata = api.tx.assets.setMetadata(ASSET_ID, ASSET_NAME, ASSET_TICKER, ASSET_DECIMALS);
    const mint = api.tx.assets.mint(ASSET_ID, alice.address, 100000000);
    const createPool = api.tx.assetConversion.createPool(native, asset);
    const addLiquidity = api.tx.assetConversion.addLiquidity(native, asset, 1000000000000, 500000, 0, 0, alice.address);

    setupTxs.push(create);
    setupTxs.push(setMetadata);
    setupTxs.push(mint);
    setupTxs.push(createPool);
    setupTxs.push(addLiquidity);

    api.tx.utility.batchAll(setupTxs).signAndSend(alice, ({ status, dispatchError }) => {
        // status would still be set, but in the case of error we can shortcut
        // to just check it (so an error would indicate InBlock or Finalized)
        if (dispatchError) {
            if (dispatchError.isModule) {
                // for module errors, we have the section indexed, lookup
                const decoded = api.registry.findMetaError(dispatchError.asModule);
                const { documentation, method, section } = decoded;

                documentation ? console.log(`\n${section}.${method}`) : console.log(`\n${section}.${method}: ${documentation.join(' ')}`);;
                process.exit();
            } else {
                // Other, CannotLookup, BadOrigin, no extra info
                console.log(dispatchError.toString());
                process.exit();
            }
        } else {
            if (status.isFinalized) {
                console.log('\ntransaction successful');
                process.exit();
            }
        }
    });

    await timeout(24000);

    await api.tx.balances
        .transferKeepAlive(bob.address, 2000000)
        .signAndSend(alice, { assetId: asset, nonce: -1 });
}

async function timeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
    .catch(console.error)
    .finally(() => process.exit());
