# Paying Transaction Fees with the Asset Conversion Pallet using Polkadot-JS

## Introduction

The `Asset Conversion Pallet` allows us to use a Non-Native Asset to create a Liquidity Pool with a Native Asset or another Non-Native Asset (but this option is yet to be implemented on a System Chain). This in turn grants us the possibility of using that Non-Native Asset to pay for transaction fees via the `ChargeAssetConversionTxPayment` signed extension, as long as it has a Liquidity Pool against a Native Asset.

Here we aim to illustrate how to use the `ChargeAssetConversionTxPayment` signed extension to pay for the fees of a `balances.transfer_keep_alive()` call with a Non-Native Asset. For this example we will use [polkadot-js](https://polkadot.js.org/docs/).

### Transaction and fee payment

First we define the asset ID of the Non-Native Asset to pay the fees of our transaction  as a XCM Multilocation:
```js
    const asset = {
        parents: 0,
        interior: {
            X2: [
                {
                    palletInstance: 50
                },
                {
                    generalIndex: 1984
                }
            ]
        }
    }
```
This concrete XCM Multilocation corresponds to the asset ID of USDT in the `Assets Pallet`. Since this asset has a Liquidity Pool against the Native Asset, we can use it to pay for the fees.

With the asset ID defined, we just need to construct the transaction. For this we assign the specified asset ID, `asset` as the `assetId`:
```js
	const tx = await api.tx.balances
		.transferKeepAlive(bob.address, 2000000)
		.signAsync(alice, { assetId: asset });

	tx.send(alice)
```
to then send the transfer.

*NOTE: Some pieces of code have been omitted to keep this example at a reasonable length, but the full code can be seen in this [repo](https://github.com/bee344/asset-conversion-example/tree/main/polkadot-js).*
