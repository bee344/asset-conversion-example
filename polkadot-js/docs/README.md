# Paying Transaction Fees with the Asset Conversion Pallet using Polkadot-JS

## Introduction

The `Asset Conversion Pallet` allows us to use a Non-Native Asset to create a Liquidity Pool with a Native Asset (currently only available in Asset Hub Westend) or another Non-Native Asset (yet to be implemented on a System Chain). This in turn grants us the possibility of using that Non-Native Asset to pay for transaction fees via the `ChargeAssetConversionTxPayment` signed extension, as long as it has a Liquidity Pool against a Native Asset.

Here we aim to illustrate how to use the `ChargeAssetConversionTxPayment` signed extension to pay for the fees of a `balances.transfer_keep_alive()` call with a Non-Native Asset. For this, we will first create and mint the asset using the Assets Pallet, and then we'll create a Liquidity Pool against the Native Asset and add liquidity to it using the Asset Conversion Pallet.

## Environment

For this example we will use [polkadot-js](https://polkadot.js.org/docs/). At the time of writing the `ChargeAssetConversionTxPayment` signed extension is not operational in the [polkadot-js api](https://github.com/polkadot-js/api/issues/5710) and subsequently it's not available in the tools that use the api, such as `txwrapper-core`. This issue is patched in our example, but a more permanent fix is expected: Same as with the 
[`assetConversionApi.quotePriceExactTokensForTokens`](https://polkadot.js.org/docs/substrate/runtime#quotepriceexacttokensfortokensasset1-xcmv3multilocation-asset2-xcmv3multilocation-amount-u128-include_fee-bool-optionbalance) that expects `XcmV3MultiLocation` for the assets, while Asset Hub Westend only
supports `MultiLocation`, problem patched by passing our own definition of `assetConversionApi.quotePriceExactTokensForTokens` at the time of creation of the ApiPromise.

We will also use [zombienet](https://github.com/paritytech/zombienet) to spawn the Westend Relay Chain and Westend Asset Hub nodes. For this we use the binaries built from the [polkadot-sdk repo](https://github.com/paritytech/polkadot-sdk), with the consideration of building the polkadot binary with the flag `--features=fast-runtime`, in order to decrease the epoch time. We also need to build the [three binaries](https://github.com/paritytech/polkadot/pull/7337) for running the nodes as local.

## Usage

To run this example first you need to have a zombienet running. For this, from the root directory run:

```bash
 ~ ./zombienet/<zombienet-binary-for-your-OS> -p native spawn ./zombienet/westend_network.toml 
```

Then, cd into the polkadot-js directory and run:

```bash
 ~ yarn example
```

And there you go, you can check the outputs for the different stages of the example.
 
## Description

### Setup

First, since Polkadot-JS doesn't have the correct implementation of the `ChargeAssetTxPayment`, we have to inject our own, as shown above. The same happens with the fixed version of `assetConversionApi.quotePriceExactTokensForTokens`. Both corrections are injected as follows:

```js
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
```

With the modified version of `assetConversionApi.quotePriceExactTokensForTokens` constructed as follows:

```js
const apiConfigRuntime = {
	spec: {
		westmint: {
			runtime: {
				AssetConversionApi: [
					{
						methods: {
							quote_price_exact_tokens_for_tokens: {
								description: 'Quote price: tokens for exact tokens',
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
```

### Asset and Liquidity Pool Creation

After that, we proceed to create a batch of transactions in which we create the asset and set its metadata, as well as creating the liquidity pool and adding liquidity to it, minting liquidity pool tokens, after defining our Native and Custom Assets in the shape of MultiLocations:

```js
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

await api.tx.utility.batchAll(setupTxs).signAndSend(alice);
```

Here we can see when our Liqudity Pool was created:

![](/polkadot-js/docs/img/20230917210550.png)

And here when the liqudity was added and the liquidity pool tokens were issued:

![](/polkadot-js/docs/img/20230917210721.png)

We also want to estimate how much the fees will be for our transaction, for which we use `paymentInfo()`:

```js
const transferInfo = await api.tx.balances.transferKeepAlive(bob.address, 2000000).paymentInfo(alice);
```

Now we have the fee estimation, we can estimate the fee in the Non-Native Asset through the runtime api `assetConversionApi.quotePriceExactTokensForTokens`:

```js
const convertedFee = await api.call.assetConversionApi.quotePriceExactTokensForTokens(native, asset, transferInfo.partialFee, true);
```


### Transaction and fee payment

Now we can finally make our transfer and pay the fees with our Non-Native Asset. For this we just have to specify the `MultiLocation` of our Non-Native Asset as the `assetId`:
```js
await api.tx.balances
	.transferKeepAlive(bob.address, 2000000)
	.signAndSend(alice, { assetId: asset });
``` 
And here we can see when the Tx Fee was paid with our Custom Asset:

![](/polkadot-js/docs/img/20230917210356.png)

And when the swap was made for the payment:

![](/polkadot-js/docs/img/20230917210438.png)

And if we look closely, the amount paid is close to our estimation.

![](/polkadot-js/docs/img/20230917210812.png)

## Conclusion

With this, we have succesfully gone through the whole process of creating and minting an asset, creating its own liquidity pool against the Native Asset, and using it to pay the fees of a transaction despite our Custom Asset not being sufficient. This grants more flexibility to the use of Custom Assets in environments where the Asset Conversion Pallet is implemented.

Thank you for your attention and we hope this example was useful.

*NOTE: Some pieces of code have been omitted to keep this example at a reasonable length, but the full code can be seen in this [repo](https://github.com/bee344/asset-conversion-example/tree/main/polkadot-js).*
