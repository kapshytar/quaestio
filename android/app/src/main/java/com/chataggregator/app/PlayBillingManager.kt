package com.chataggregator.app

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.PendingPurchasesParams

class PlayBillingManager(
    private val context: Context,
    private val listener: Listener
) : PurchasesUpdatedListener {

    interface Listener {
        fun onSubscriptionStateChanged(active: Boolean)
        fun onBillingMessage(messageResId: Int)
    }

    companion object {
        private const val TAG = "PlayBillingManager"
        const val SUBSCRIPTION_PRODUCT_ID = "gunshi_monthly"
    }

    private val billingClient: BillingClient = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build()
        )
        .build()

    private var productDetails: ProductDetails? = null
    var isSubscribed: Boolean = false
        private set

    fun start() {
        if (billingClient.isReady) {
            queryProducts()
            refreshPurchases()
            return
        }
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    queryProducts()
                    refreshPurchases()
                } else {
                    Log.w(TAG, "Billing setup failed: ${result.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected")
            }
        })
    }

    fun destroy() {
        if (billingClient.isReady) {
            billingClient.endConnection()
        }
    }

    fun launchSubscriptionPurchase(activity: Activity) {
        val details = productDetails
        if (!billingClient.isReady || details == null) {
            start()
            listener.onBillingMessage(R.string.subscription_not_ready)
            return
        }

        val offerToken = pickOfferToken(details)
        val productParamsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
        if (offerToken != null) {
            productParamsBuilder.setOfferToken(offerToken)
        }

        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParamsBuilder.build()))
            .build()

        val result = billingClient.launchBillingFlow(activity, params)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "Launch billing flow failed: ${result.debugMessage}")
            listener.onBillingMessage(R.string.subscription_open_failed)
        }
    }

    private fun queryProducts() {
        val product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(SUBSCRIPTION_PRODUCT_ID)
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(product))
            .build()

        billingClient.queryProductDetailsAsync(params) { result, queryResult ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "Query product details failed: ${result.debugMessage}")
                return@queryProductDetailsAsync
            }
            productDetails = queryResult.productDetailsList.firstOrNull()
            if (productDetails == null) {
                Log.w(TAG, "Subscription product not found: $SUBSCRIPTION_PRODUCT_ID")
            }
        }
    }

    private fun refreshPurchases() {
        if (!billingClient.isReady) return
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "Query purchases failed: ${result.debugMessage}")
                return@queryPurchasesAsync
            }
            handlePurchases(purchases)
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> handlePurchases(purchases.orEmpty())
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                // no-op
            }
            else -> {
                Log.w(TAG, "Purchases update failed: ${result.debugMessage}")
                listener.onBillingMessage(R.string.subscription_purchase_failed)
            }
        }
    }

    private fun handlePurchases(purchases: List<Purchase>) {
        var active = false
        purchases.forEach { purchase ->
            val hasProduct = purchase.products.contains(SUBSCRIPTION_PRODUCT_ID)
            if (!hasProduct) return@forEach

            if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                active = true
                if (!purchase.isAcknowledged) {
                    val ackParams = AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(purchase.purchaseToken)
                        .build()
                    billingClient.acknowledgePurchase(ackParams) { ackResult ->
                        if (ackResult.responseCode != BillingClient.BillingResponseCode.OK) {
                            Log.w(TAG, "Acknowledge failed: ${ackResult.debugMessage}")
                        }
                    }
                }
            }
        }

        if (active != isSubscribed) {
            isSubscribed = active
            listener.onSubscriptionStateChanged(active)
        }
    }

    private fun pickOfferToken(details: ProductDetails): String? {
        val offers = details.subscriptionOfferDetails.orEmpty()
        if (offers.isEmpty()) return null

        // Prefer trial offer when configured in Play Console.
        val trialOffer = offers.firstOrNull { offer ->
            offer.pricingPhases.pricingPhaseList.any { phase ->
                phase.priceAmountMicros == 0L
            }
        }
        return (trialOffer ?: offers.first()).offerToken
    }
}
