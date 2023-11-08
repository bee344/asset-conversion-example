# Paying Transaction Fees with the Asset Conversion Pallet using Subxt

## Introduction

The `Asset Conversion Pallet` allows us to use a Non-Native Asset to create a Liquidity Pool with a Native Asset or another Non-Native Asset (but this option is yet to be implemented on a System Chain). This in turn grants us the possibility of using that Non-Native Asset to pay for transaction fees via the `ChargeAssetConversionTxPayment` signed extension, as long as it has a Liquidity Pool against a Native Asset.

Here we aim to illustrate how to use the `ChargeAssetConversionTxPayment` signed extension to pay for the fees of a `balances.transfer_keep_alive()` call with a Non-Native Asset. For this, we will first create and mint the asset using the Assets Pallet, and then we'll create a Liquidity Pool against the Native Asset and add liquidity to it using the Asset Conversion Pallet.

## Environment

For this example we will use [subxt](https://github.com/paritytech/subxt) as a way to communicate directly to the runtime, since at the time of writing the `ChargeAssetConversionTxPayment` signed extension is not operational  in the [polkadot-js api](https://github.com/polkadot-js/api/issues/5710) and subsequently it's not available in the tools that use the api, such as `txwrapper-core`. 

We will also use [zombienet](https://github.com/paritytech/zombienet) to spawn the Westend Relay Chain and Westend Asset Hub nodes. For this we use the binaries built from the [polkadot-sdk repo](https://github.com/paritytech/polkadot-sdk), with the consideration of building the polkadot binary with the flag `--features=fast-runtime`, in order to decrease the epoch time. We also need to build the [three binaries](https://github.com/paritytech/polkadot/pull/7337) for running the nodes as local.

## Usage

To run this example first you need to have a zombienet running. For this, from the root directory run:

```bash
 ~ ./zombienet/<zombienet-binary-for-your-OS> -p native spawn ./zombienet/westend_network.toml 
```

Then, cd into the subxt directory and run:

```bash
 ~ cargo run asset-conversion-example
```

And there you go, you can check the outputs for the different stages of the example.
 
## Description

### Setup

First, since subxt doesn't have a specific config for Asset Hub Westend and the ones available for [Polkadot](https://github.com/paritytech/subxt/blob/c8462defabad10a2c09f945737731e7259f809dd/subxt/src/config/polkadot.rs#L16C1-L24C1) and [Substrate](https://github.com/paritytech/subxt/blob/c8462defabad10a2c09f945737731e7259f809dd/subxt/src/config/substrate.rs#L19C1-L28C1) don't contain the `ChargeAssetConversionTxPayment` [signed extension](https://github.com/paritytech/subxt/blob/master/subxt/src/config/signed_extensions.rs) , we have to create our own custom config, reutilizing the existing Signed Extensions provided by `subxt` and adding our own version
of the `ChargeAssetTxPayment`:

```rust
pub enum CustomConfig {}

impl Config for CustomConfig {
    type Hash = <SubstrateConfig as Config>::Hash;
    type AccountId = <SubstrateConfig as Config>::AccountId;
    type Address = <PolkadotConfig as Config>::Address;
    type Signature = <SubstrateConfig as Config>::Signature;
    type Hasher = <SubstrateConfig as Config>::Hasher;
    type Header = <SubstrateConfig as Config>::Header;
    type ExtrinsicParams = signed_extensions::AnyOf<
        Self,
        (
            signed_extensions::CheckSpecVersion,
            signed_extensions::CheckTxVersion,
            signed_extensions::CheckNonce,
            signed_extensions::CheckGenesis<Self>,
            signed_extensions::CheckMortality<Self>,
            signed_extensions::ChargeTransactionPayment,
            ChargeAssetTxPayment,
        ),
    >;
}
```

Now we define and implement `ChargeAssetTxPayment` in the same way as the original, 
but having it accept a `MultiLocation` for the `assetId`:

```rust
#[derive(Debug)]
pub struct ChargeAssetTxPayment {
    tip: Compact<u128>,
    asset_id: Option<MultiLocation>,
}

impl ChargeAssetTxPaymentParams {
    pub fn no_tip() -> Self {
        ChargeAssetTxPaymentParams {
            tip: 0,
            asset_id: None,
        }
    }
    pub fn tip(tip: u128) -> Self {
        ChargeAssetTxPaymentParams {
            tip,
            asset_id: None,
        }
    }
    pub fn tip_of(tip: u128, asset_id: MultiLocation) -> Self {
        ChargeAssetTxPaymentParams {
            tip,
            asset_id: Some(asset_id),
        }
    }
}
```

We define the parameters for the `SignedExtension`:

```rust
impl<T: Config> ExtrinsicParams<T> for ChargeAssetTxPayment {
    type OtherParams = ChargeAssetTxPaymentParams;
    type Error = std::convert::Infallible;

    fn new<Client: OfflineClientT<T>>(
        _nonce: u64,
        _client: Client,
        other_params: Self::OtherParams,
    ) -> Result<Self, Self::Error> {
        Ok(ChargeAssetTxPayment {
            tip: Compact(other_params.tip),
            asset_id: other_params.asset_id,
        })
    }
}
```

And we implement the encoder to make sure it's encoded correctly and give it a
name:

```rust
impl ExtrinsicParamsEncoder for ChargeAssetTxPayment {
    fn encode_extra_to(&self, v: &mut Vec<u8>) {
        let asset_id = &self.asset_id;
        (self.tip, asset_id).encode_to(v);
    }
}

impl<T: Config> signed_extensions::SignedExtension<T> for ChargeAssetTxPayment {
    const NAME: &'static str = "ChargeAssetTxPayment";
}
```

Finally, we define our custom builder that intakes `DefaultExtrinsicParamsBuilder`
with our `CustomConfig` and the additional parameters of `ChargeAssetTxPaymentParams`.
Note that we ignore the part of `DefaultExtrinsicParamsBuilder` where the original
`ChargeAssetTxPayment` is located, to avoid name collision:

```rust
pub fn custom(
    params: DefaultExtrinsicParamsBuilder<CustomConfig>,
    other_params: ChargeAssetTxPaymentParams,
) -> <<CustomConfig as Config>::ExtrinsicParams as ExtrinsicParams<CustomConfig>>::OtherParams {
    let (a, b, c, d, e, _, g) = params.build();
    (a, b, c, d, e, g, other_params)
}
```

For this we use the runtime metadata corresponding to our node and some types we
retrieve from it:

```rust
#[subxt::subxt(runtime_metadata_path = "../artifacts/asset_hub_metadata.scale")]

pub mod local {}

type MultiLocation = local::runtime_types::staging_xcm::v3::multilocation::MultiLocation;

use local::runtime_types::staging_xcm::v3::junction::Junction::{GeneralIndex, PalletInstance};
use local::runtime_types::staging_xcm::v3::junctions::Junctions::{Here, X2};

type Call = local::runtime_types::asset_hub_westend_runtime::RuntimeCall;
type AssetConversionCall = local::runtime_types::pallet_asset_conversion::pallet::Call;

type AssetsCall = local::runtime_types::pallet_assets::pallet::Call;
```

### Asset and Liquidity Pool Creation

After that, we proceed to create a batch of transactions in which we create the asset and set its metadata, as well as creating the liquidity pool and adding liquidity to it, minting liquidity pool tokens:

```rust
async fn prepare_setup(api: OnlineClient<CustomConfig>) {

    let alice: MultiAddress<AccountId32, ()> = dev::alice().public_key().into();
    let address: AccountId32 = dev::alice().public_key().into();   
	let mut call_buffer: Vec<Call> = Vec::<Call>::new();
    
	call_buffer.push(create_asset_call(alice.clone(), 1).unwrap());
	call_buffer.push(
	    set_asset_metadata_call(
	        ASSET_ID,
	        NAME.as_bytes().to_vec(),
	        SYMBOL.as_bytes().to_vec(),
	        0,
	    )
	    .unwrap(),
	);
	
	const AMOUNT_TO_MINT: u128 = 100000000000000;
	
	call_buffer.push(mint_token_call( alice.clone(), AMOUNT_TO_MINT).unwrap());
    call_buffer.push(create_pool_with_native_call().unwrap());
    call_buffer.push(
	    provide_liquidity_to_token_native_pool_call(
	        10000000000,
	        10000000,
	        0,
	        0,
	        address,
	    )
	    .unwrap(),
	);

    if let Err(subxt::Error::Runtime(dispatch_err)) =
	    sign_and_send_batch_calls(api, call_buffer).await
	{
	    eprintln!("Could not dispatch the call: {}", dispatch_err);
	}
}
```

Here we can see when our Liqudity Pool was created:

![](/subxt/docs/img/20230917210550.png)

And here when the liqudity was added and the liquidity pool tokens were issued:

![](/subxt/docs/img/20230917210721.png)

We also want to estimate how much the fees will be for our transaction, for which we use `TransactionPaymentApi` through `partial_fee_estimate()`:

```rust
async fn estimate_fees(
	api: OnlineClient<CustomConfig>,
	dest: MultiAddress<AccountId32, ()>,
	amount: u128,
	) {
	let alice = dev::alice();
	let balance_transfer_tx = local::tx().balances().transfer_keep_alive(dest, amount);
	let signed = api.tx().create_signed(&balance_transfer_tx, &alice, Default::default()).await.unwrap();
	let partial_fee = signed.partial_fee_estimate().await.unwrap();
	println!("The estimated fee is: {partial_fee}");
}
```

Now we have the fee estimation, we can estimate the fee in the Non-Native Asset through the runtime api `AssetConversionApi.quote_price_exact_tokens_for_tokens`:

```rust
async fn convert_fees(
	api: OnlineClient<CustomConfig>,
	amount: u128,
) -> Result<(), Box<dyn std::error::Error>> {

	let native = MultiLocation {
		parents: 1,
		interior: Here,
	};
	
	let asset = MultiLocation {
		parents: 0,
		interior: X2(PalletInstance(50), GeneralIndex(ASSET_ID.into())),	
	};
	
	let amount = amount;
	
	let include_fee = true;

	let runtime_apis = local::apis().asset_conversion_api().quote_price_exact_tokens_for_tokens(
		native,
		asset,
		amount,
		include_fee
	);

	let converted_fee = api.runtime_api().at_latest().await.unwrap().call(runtime_apis).await.unwrap();
	println!("The estimated fee in the custom asset is: {:#}", converted_fee.unwrap());

	Ok(())
}
```
### Transaction and fee payment

Now we can finally make our transfer and pay the fees with our Non-Native Asset. For this we have to add our own custom function to compose the tuple of signed extensions, adding the `MultiLocation` of our Non-Native Asset as a parameter:
```rust
async fn sign_and_send_transfer(
    api: OnlineClient<CustomConfig>,
    dest: MultiAddress<AccountId32, ()>,
    amount: u128,
    multi: MultiLocation,
) -> Result<(), subxt::Error> {
    let alice_pair_signer = dev::alice();
    let balance_transfer_tx = local::tx().balances().transfer_keep_alive(dest, amount);
    
    let tx_params = DefaultExtrinsicParamsBuilder::new();
    
    // Here we send the Native asset transfer and wait for it to be finalized, while
    // listening for the `AssetTxFeePaid` event that confirms we succesfully paid
    // the fees with our custom asset
    api
    .tx()
    .sign_and_submit_then_watch(&balance_transfer_tx, &alice_pair_signer, custom(tx_params, ChargeAssetTxPaymentParams::tip_of(0, multi)))
    .await?
    .wait_for_finalized_success()
    .await?
    .has::<local::asset_conversion_tx_payment::events::AssetTxFeePaid>()?;
    
    println!("Balance transfer submitted and fee paid succesfully");
    Ok(())
}
```

We also use `.has::<local::asset_conversion_tx_payment::events::AssetTxFeePaid>()?` to listen for the event that confirms that the fees have been paid correctly:

![](/subxt/docs/img/20230917210356.png)

We could also use `asset_conversion::events::SwapExecuted` as an indicator since it's emitted when the swap between two tokens integrating a liquidity pool are interchanged, in this case in order to pay for the transaction fees:

![](/subxt/docs/img/20230917210438.png)


And if we look closely, the amount paid is close to our estimation.

![](/subxt/docs/img/20230917210813.png)

## Conclusion

With this, we have succesfully gone through the whole process of creating and minting an asset, creating its own liquidity pool against the Native Asset, and using it to pay the fees of a transaction despite our Custom Asset not being sufficient. This grants more flexibility to the use of Custom Assets in environments where the Asset Conversion Pallet is implemented.

Thank you for your attention and we hope this example was useful.

*NOTE: Some pieces of code have been omitted to keep this example at a reasonable length, but the full code can be seen in this [repo](https://github.com/bee344/asset-conversion-example/tree/main/subxt).*
