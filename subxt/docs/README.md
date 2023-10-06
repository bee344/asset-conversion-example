# Paying Transaction Fees with the Asset Conversion Pallet

## Introduction

The `Asset Conversion Pallet` allows us to use a Non-Native Asset to create a Liquidity Pool with a Native Asset (currently only available in Asset Hub Westend) or another Non-Native Asset (yet to be implemented on a System Chain). This in turn grants us the possibility of using that Non-Native Asset to pay for transaction fees via the `ChargeAssetConversionTxPayment` signed extension, as long as it has a Liquidity Pool against a Native Asset.

Here we aim to illustrate how to use the `ChargeAssetConversionTxPayment` signed extension to pay for the fees of a `balances.transfer_keep_alive()` call with a Non-Native Asset. For this, we will first create and mint the asset using the Assets Pallet, and then we'll create a Liquidity Pool against the Native Asset and add liquidity to it using the Asset Conversion Pallet.

## Environment

For this example we will use [subxt](https://github.com/paritytech/subxt) as a way to communicate directly to the runtime, since at the time of writing the `ChargeAssetConversionTxPayment` signed extension is not operational  in the [polkadot-js api](https://github.com/polkadot-js/api/issues/5710) and subsequently it's not available in the tools that use the api, such as `txwrapper-core`. 

We will also use [zombienet](https://github.com/paritytech/zombienet) to spawn the Westend Relay Chain and Westend Asset Hub nodes. For this we use the binaries built from the [polkadot-sdk repo](https://github.com/paritytech/polkadot-sdk), with the consideration of building the polkadot binary with the flag `--features=fast-runtime`, in order to decrease the epoch time. We also need to build the [three binaries](https://github.com/paritytech/polkadot/pull/7337) for running the nodes as local.

## Description

### Setup

First, since subxt doesn't have a specific config for Asset Hub Westend and the ones available for [Polkadot](https://github.com/paritytech/subxt/blob/c8462defabad10a2c09f945737731e7259f809dd/subxt/src/config/polkadot.rs#L16C1-L24C1) and [Substrate](https://github.com/paritytech/subxt/blob/c8462defabad10a2c09f945737731e7259f809dd/subxt/src/config/substrate.rs#L19C1-L28C1) don't contain the `ChargeAssetConversionTxPayment` [signed extension](https://github.com/paritytech/subxt/blob/master/subxt/src/config/signed_extensions.rs) , we have to create our own custom config:

```
pub enum CustomConfig {}

impl Config for CustomConfig {

    type Hash = <SubstrateConfig as Config>::Hash;
    
	type AccountId = <SubstrateConfig as Config>::AccountId;
    
	type Address = <PolkadotConfig as Config>::Address;
    
	type Signature = <SubstrateConfig as Config>::Signature;
    
	type Hasher = <SubstrateConfig as Config>::Hasher;
    
	type Header = <SubstrateConfig as Config>::Header;
    
	type ExtrinsicParams = WestmintExtrinsicParams<Self>;

}
```

Setup the `ExtrinsicParams` as `WestmintExtrinsicParams<T>` and its builder as 
`WestmintExtrinsicParamsBuilder<T>` using the `BaseExtrinsicParams` and 
`BaseExtrinsicParamsBuilder` and adding the `AssetTip` struct to pass the 
`MultiLocation` of the Custom Asset in the form of a "tip".

```
pub type WestmintExtrinsicParams<T> = BaseExtrinsicParams<T, AssetTip>;

pub type WestmintExtrinsicParamsBuilder<T> = BaseExtrinsicParamsBuilder<T, AssetTip>;
```
And also create the `AssetTip` we want to add to the config:

```
#[derive(Debug, Default, Encode)]

pub struct AssetTip {

    #[codec(compact)]

    tip: u128,

    asset: Option<MultiLocation>,

}

impl AssetTip {

    pub fn new(amount: u128) -> Self {

        AssetTip {

            tip: amount,

            asset: None,

        }

    }

    pub fn of_asset(mut self, asset: MultiLocation) -> Self {

        self.asset = Some(asset);

        self

    }

}

impl From<u128> for AssetTip {

    fn from(n: u128) -> Self {

        AssetTip::new(n)

    }

}
```

For this we use the runtime metadata corresponding to our node and some types we retrieve from it:

```
#[subxt::subxt(runtime_metadata_path = "../artifacts/asset_hub_metadata.scale")]

pub mod local {}

type MultiLocation = local::runtime_types::staging_xcm::v3::multilocation::MultiLocation;

use local::runtime_types::staging_xcm::v3::junction::Junction::{GeneralIndex, PalletInstance};

use local::runtime_types::staging_xcm::v3::junctions::Junctions::{Here, X2};

type Call = local::runtime_types::asset_hub_westend_runtime::RuntimeCall;

type AssetConversionCall = local::runtime_types::pallet_asset_conversion::pallet::Call;

type AssetsCall = local::runtime_types::pallet_assets::pallet::Call;
```

### Asset and Liqudity Pool Creation

After that, we proceed to create a batch of transactions in which we crate the asset and set its metadata, as well as creating the liqudity pool and adding liquidity to it, minting liquidity pool tokens:

```
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

```
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

```
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
```
async fn sign_and_send_transfer(

	api: OnlineClient<CustomConfig>,
	
	dest: MultiAddress<AccountId32, ()>,
	
	amount: u128,
	
	multi: MultiLocation,
	
	) -> Result<(), subxt::Error> {
	
		let alice_pair_signer = dev::alice();
		
		let balance_transfer_tx = local::tx().balances().transfer_keep_alive(dest, amount);
				
		let tx_params = WestmintExtrinsicParamsBuilder::new().tip(AssetTip::new(0).of_asset(multi));
		
		api
		
		.tx()
		
		.sign_and_submit_then_watch(&balance_transfer_tx, &alice_pair_signer, tx_params)
		
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

![](/subxt/docs/img/20230917210812.png)

## Conclusion

With this, we have succesfully gone through the whole process of creating and minting an asset, creating its own liquidity pool against the Native Asset, and using it to pay the fees of a transaction despite our Custom Asset not being sufficient. This grants more flexibility to the use of Custom Assets in environments where the Asset Conversion Pallet is implemented.

Thank you for your attention and we hope this example was useful.

*NOTE: Some pieces of code have been omitted to keep this example at a reasonable length, but the full code can be seen in this [repo](https://github.com/bee344/asset-conversion-example/tree/main/subxt).*
