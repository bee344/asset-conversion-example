# Paying Transaction Fees with the Asset Conversion Pallet using Subxt

## Introduction

The `Asset Conversion Pallet` allows us to use a Non-Native Asset to create a Liquidity Pool with a Native Asset or another Non-Native Asset (but this option is yet to be implemented on a System Chain). This in turn grants us the possibility of using that Non-Native Asset to pay for transaction fees via the `ChargeAssetConversionTxPayment` signed extension, as long as it has a Liquidity Pool against a Native Asset.

Here we aim to illustrate how to use the `ChargeAssetConversionTxPayment` signed extension to pay for the fees of a `balances.transfer_keep_alive()` call with a Non-Native Asset. For this, we will first create and mint the asset using the Assets Pallet, and then we'll create a Liquidity Pool against the Native Asset and add liquidity to it using the Asset Conversion Pallet.

## Environment

For this example we will use [subxt](https://github.com/paritytech/subxt) as a way to communicate directly to the runtime. 

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

First, since subxt doesn't have a specific config for Asset Hub Westend:

```rust
pub enum CustomConfig {}

impl Config for CustomConfig {
    type AccountId = <PolkadotConfig as Config>::AccountId;
    type Address = <PolkadotConfig as Config>::Address;
    type Signature = <PolkadotConfig as Config>::Signature;
    type Hasher = <PolkadotConfig as Config>::Hasher;
    type Header = <PolkadotConfig as Config>::Header;
    type ExtrinsicParams = DefaultExtrinsicParams<CustomConfig>;
    type AssetId = Location;
}
```
For this we use the runtime metadata corresponding to our node and some types we
retrieve from it:

```rust
#[subxt::subxt(runtime_metadata_path = "./metadata/metadata.scale",
derive_for_type(
    path = "staging_xcm::v5::location::Location",
    derive = "Clone, codec::Encode",
    recursive
))]
pub mod local {}

// Types that we retrieve from the Metadata for our example
use local::runtime_types::staging_xcm::v5::location::Location;

use local::runtime_types::staging_xcm::v5::junction::Junction::{GeneralIndex, PalletInstance};
use local::runtime_types::staging_xcm::v5::junctions::Junctions::Here;

type Call = local::runtime_types::asset_hub_westend_runtime::RuntimeCall;
type AssetConversionCall = local::asset_conversion::Call;
type AssetsCall = local::assets::Call;
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
    ) -> Result<u128, Box<dyn std::error::Error>> {
    let alice = dev::alice();

    let balance_transfer_tx = local::tx().balances().transfer_keep_alive(dest, amount);
    
    let signed = api.tx().create_signed(&balance_transfer_tx, &alice, Default::default()).await.unwrap();
    
    let partial_fee: u128 = signed.partial_fee_estimate().await.unwrap();
    
    println!("\nThe estimated fee is: {partial_fee} Plancks\n");

    Ok(partial_fee)
}
```

Now we have the fee estimation, we can estimate the fee in the Non-Native Asset through the runtime api `AssetConversionApi.quote_price_exact_tokens_for_tokens`:

```rust
async fn convert_fees(
    api: OnlineClient<CustomConfig>,
    amount: u128,
) -> Result<(), Box<dyn std::error::Error>> {
    let native: Location = Location {
        parents: 1,
        interior: Here,
    };
    let asset: Location = Location {
        parents: 0,
        interior: local::runtime_types::staging_xcm::v5::junctions::Junctions::X2([PalletInstance(50), GeneralIndex(ASSET_ID.into())]),
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

    println!("\nThe estimated fee in the custom asset is: {:#} TSTY\n", converted_fee.unwrap());

    Ok(())
}
```
### Transaction and fee payment

Now we can finally make our transfer and pay the fees with our Non-Native Asset. For this we have to add our own custom function to compose the tuple of signed extensions, adding the `Location` of our Non-Native Asset as a parameter:
```rust
async fn sign_and_send_transfer(
    api: OnlineClient<CustomConfig>,
    dest: MultiAddress<AccountId32, ()>,
    amount: u128,
    multi: Location,
) -> Result<(), subxt::Error> {
    let alice_pair_signer = dev::alice();
    let balance_transfer_tx = local::tx().balances().transfer_keep_alive(dest, amount);
    
    let tx_config = DefaultExtrinsicParamsBuilder::<CustomConfig>::new()
    .tip_of(0, multi)
    .build();
    
    // Here we send the Native asset transfer and wait for it to be finalized, while
    // listening for the `AssetTxFeePaid` event that confirms we succesfully paid
    // the fees with our custom asset
    api
    .tx()
    .sign_and_submit_then_watch(&balance_transfer_tx, &alice_pair_signer, tx_config)
    .await?
    .wait_for_finalized_success()
    .await?
    .has::<local::asset_tx_payment::events::AssetTxFeePaid>()?;
    
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
