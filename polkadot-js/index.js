const { Keyring } = require("@polkadot/keyring");
const { ApiPromise, WsProvider } = require("@polkadot/api");
const { cryptoWaitReady } = require("@polkadot/util-crypto");

async function main() {

    /**
     * Here we set our local Asset Hub node as the wsProvider 
     */
    const wsProvider = new WsProvider("ws://127.0.0.1:9944");

    /**
     * We use the wsProvider defined above to create the ApiPromise.
     */
    const api = await ApiPromise.create({
        provider: wsProvider,
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

    const asset = {
        parents: 0,
        interior: {
            X2: [
                {
                    palletInstance: 50
                },
                {
                    generalIndex: 1
                }
            ]
        }
    }

    /**
     * Now we just send a regular transfer of the existential amount of DOT.
     */
    const tx = await api.tx.balances
        .transferKeepAlive(bob.address, 100000)
        .signAsync(alice, { tip: 200, assetId: asset });

    console.log(tx.toHuman());

    await tx.send();

    console.log(`\nTransaction successful`);
}

main()
    .catch(console.error)
    .finally(() => process.exit());

    