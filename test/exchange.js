/* global  artifacts:true, web3: true, contract: true */
import chai from 'chai'
import Web3 from 'web3'
import bnChai from 'bn-chai'
import {ether, wrappedEther} from './constants'
import {expectRevert} from './helpers'
import {
    getCancelOrderAddresses,
    getCancelOrderValues,
    getOrderHash,
    getTradeHash,
    getMatchOrderAddresses,
    getMatchOrderValues
} from "./utils/exchange";
import {getBalances} from "./utils/balances";

chai
    .use(require('chai-bignumber')(web3.BigNumber))
    .use(bnChai(require('bn.js')))
    .should();

const WETH = artifacts.require('./utils/WETH9.sol');
const Exchange = artifacts.require('./Exchange.sol');
const Token1 = artifacts.require('./contracts/tokens/Token1.sol');
const Token2 = artifacts.require('./contracts/tokens/Token2.sol');

contract('Exchange', (accounts) => {
    let web3 = new Web3('http://localhost:8545');

    let owner = accounts[0];
    let feeAccount = accounts[1];
    let operator = accounts[2];
    let trader1 = accounts[3];
    let trader2 = accounts[4];
    let anyUser = accounts[5];

    let privateKeyOfTrader1 = '0x2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501203';
    let privateKeyOfTrader2 = '0x2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501204';

    let exchange;
    let weth;
    let token1;
    let token2;

    let initialBalances;

    describe('Initialisation', async () => {
        beforeEach(async () => {
            weth = await WETH.new();
            exchange = await Exchange.new(weth.address, feeAccount)
        });

        it('should initialise owner correctly', async () => {
            let initializedOwner = await exchange.owner.call();
            initializedOwner.should.be.equal(owner)
        });

        it('should initialise fee account correctly', async () => {
            let initializedFeeAccount = await exchange.feeAccount.call();
            initializedFeeAccount.should.be.equal(feeAccount)
        });

        it('should initialise WETH token contract correctly', async () => {
            let initializedWethTokenContract = await exchange.WETH_TOKEN_CONTRACT.call();
            initializedWethTokenContract.should.be.equal(weth.address)
        })
    });

    describe('WETH token management', async () => {
        beforeEach(async () => {
            weth = await WETH.new();
            exchange = await Exchange.new(weth.address, feeAccount)
        });

        it('should set WETH token address if requested by owner', async () => {
            let expectedWethTokenAddress = accounts[6];
            await exchange.setWethToken(expectedWethTokenAddress, {from: owner});

            let wethTokenContractAddress = await exchange.WETH_TOKEN_CONTRACT.call();
            wethTokenContractAddress.should.be.equal(expectedWethTokenAddress)
        });

        it('should not set WETH token address if not requested by owner', async () => {
            await exchange.setOperator(operator, true, {from: owner});
            let newWethTokenAddress = accounts[6];
            await expectRevert(exchange.setWethToken(newWethTokenAddress, {from: operator}));
            await expectRevert(exchange.setWethToken(newWethTokenAddress, {from: anyUser}))
        })
    });

    describe('Operator management', async () => {
        beforeEach(async () => {
            weth = await WETH.new();
            exchange = await Exchange.new(weth.address, feeAccount)
        });

        it('should set operator if requested by owner', async () => {
            let expectedOperator = accounts[2];
            await exchange.setOperator(expectedOperator, true, {from: owner});

            let isOperator = await exchange.operators.call(expectedOperator);
            isOperator.should.be.equal(true);

            await exchange.setOperator(expectedOperator, false, {from: owner});

            isOperator = await exchange.operators.call(expectedOperator);
            isOperator.should.be.equal(false)
        });

        it('should not set operator if not requested by owner', async () => {
            await exchange.setOperator(operator, true, {from: owner});

            let newOperator = accounts[7];
            await expectRevert(exchange.setOperator(newOperator, true, {from: operator}));
            await expectRevert(exchange.setOperator(newOperator, true, {from: anyUser}))
        })
    });

    describe('Fee account management', async () => {
        beforeEach(async () => {
            weth = await WETH.new();
            exchange = await Exchange.new(weth.address, feeAccount);

            await exchange.setOperator(operator, true, {from: owner})
        });

        it('should set fee account if requested by owner', async () => {
            let expectedNewFeeAccount = accounts[3];
            await exchange.setFeeAccount(expectedNewFeeAccount, {from: owner});

            let newFeeAccount = await exchange.feeAccount.call();
            newFeeAccount.should.be.equal(expectedNewFeeAccount)
        });

        it('should set fee account if requested by operator', async () => {
            let expectedNewFeeAccount = accounts[3];
            await exchange.setFeeAccount(expectedNewFeeAccount, {from: operator});

            let newFeeAccount = await exchange.feeAccount.call();
            newFeeAccount.should.be.equal(expectedNewFeeAccount)
        });

        it('should not set fee account if not requested by owner or operator', async () => {
            let expectedNewFeeAccount = accounts[3];
            await expectRevert(exchange.setFeeAccount(expectedNewFeeAccount, {from: anyUser}))
        })
    });

    describe('Cancelling order', async () => {
        beforeEach(async () => {
            weth = await WETH.new();
            exchange = await Exchange.new(weth.address, feeAccount);
            token1 = await Token1.new(trader1, 1000);
            token2 = await Token2.new(trader2, 1000);

            await exchange.setOperator(operator, true, {from: owner});

            await weth.deposit({from: trader1, value: ether});
            weth.approve(exchange.address, wrappedEther, {from: trader1});

            await weth.deposit({from: trader2, value: ether});
            weth.approve(exchange.address, wrappedEther, {from: trader2});

            await token1.approve(exchange.address, 1000, {from: trader1});
            await token2.approve(exchange.address, 1000, {from: trader2})
        });

        it('should execute if requested by maker of order', async () => {
            let initialBlockNumber = await web3.eth.getBlockNumber();

            let order = {
                amountBuy: 1000,
                amountSell: 1000,
                expires: initialBlockNumber + 10,
                nonce: 1,
                feeMake: 1e17,
                feeTake: 1e17,
                tokenBuy: token2.address,
                tokenSell: token1.address,
                maker: trader1
            };

            let orderHash = getOrderHash(exchange, order);

            let {message, messageHash, r, s, v} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);

            let cancelOrderValues = getCancelOrderValues(order);
            let cancelOrderAddresses = getCancelOrderAddresses(order);

            await exchange.cancelOrder(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: trader1});

            let orderFill = await exchange.filled.call(orderHash);
            orderFill.should.be.bignumber.equal(order.amountBuy)
        });

        it('should not execute if not requested by maker of order', async () => {
            let initialBlockNumber = await web3.eth.getBlockNumber();

            let order = {
                amountBuy: 1000,
                amountSell: 1000,
                expires: initialBlockNumber + 10,
                nonce: 1,
                feeMake: 1e17,
                feeTake: 1e17,
                tokenBuy: token2.address,
                tokenSell: token1.address,
                maker: trader1
            };

            let orderHash = getOrderHash(exchange, order);

            let {message, messageHash, r, s, v} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);

            let cancelOrderValues = getCancelOrderValues(order);
            let cancelOrderAddresses = getCancelOrderAddresses(order);

            let orderCancellationResultForOwner = await exchange.cancelOrder.call(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: owner});

            let orderCancellationResultForOperator = await exchange.cancelOrder.call(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: operator});

            let orderCancellationResultForAnyUser = await exchange.cancelOrder.call(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: anyUser});

            orderCancellationResultForOwner.should.be.equal(false);
            orderCancellationResultForOperator.should.be.equal(false);
            orderCancellationResultForAnyUser.should.be.equal(false);

            await exchange.cancelOrder(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: owner});

            let orderFillAfterOrderCancelByOwner = await exchange.filled.call(orderHash);
            orderFillAfterOrderCancelByOwner.should.be.bignumber.equal(0);

            await exchange.cancelOrder(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: operator});

            let orderFillAfterOrderCancelByOperator = await exchange.filled.call(orderHash);
            orderFillAfterOrderCancelByOperator.should.be.bignumber.equal(0);

            await exchange.cancelOrder(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: anyUser});

            let orderFillAfterOrderCancelByAnyUser = await exchange.filled.call(orderHash);
            orderFillAfterOrderCancelByAnyUser.should.be.bignumber.equal(0);
        });

        it('should not execute if maker signature is invalid', async () => {
            let initialBlockNumber = await web3.eth.getBlockNumber();

            let order = {
                amountBuy: 1000,
                amountSell: 1000,
                expires: initialBlockNumber + 10,
                nonce: 1,
                feeMake: 1e17,
                feeTake: 1e17,
                tokenBuy: token2.address,
                tokenSell: token1.address,
                maker: trader1
            };

            let orderHash = getOrderHash(exchange, order);

            let {message, messageHash, r, s, v} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader2);

            let cancelOrderValues = getCancelOrderValues(order);
            let cancelOrderAddresses = getCancelOrderAddresses(order);

            let orderCancellationResult = await exchange.cancelOrder.call(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: trader1});

            orderCancellationResult.should.be.equal(false);

            await exchange.cancelOrder(
                cancelOrderValues,
                cancelOrderAddresses,
                v,
                r,
                s,
                {from: trader1});

            let orderFill = await exchange.filled.call(orderHash);
            orderFill.should.be.bignumber.equal(0);
        })
    });

    describe('Cancelling trade', async () => {
        beforeEach(async () => {
            weth = await WETH.new();
            exchange = await Exchange.new(weth.address, feeAccount);
            token1 = await Token1.new(trader1, 1000);
            token2 = await Token2.new(trader2, 1000);

            await exchange.setOperator(operator, true, {from: owner});

            await weth.deposit({from: trader1, value: ether});
            weth.approve(exchange.address, wrappedEther, {from: trader1});

            await weth.deposit({from: trader2, value: ether});
            weth.approve(exchange.address, wrappedEther, {from: trader2});

            await token1.approve(exchange.address, 1000, {from: trader1});
            await token2.approve(exchange.address, 1000, {from: trader2})
        });

        it('should execute if requested by taker of trade', async () => {
            let initialBlockNumber = await web3.eth.getBlockNumber();

            let order = {
                amountBuy: 1000,
                amountSell: 1000,
                expires: initialBlockNumber + 10,
                nonce: 1,
                feeMake: 1e17,
                feeTake: 1e17,
                tokenBuy: token2.address,
                tokenSell: token1.address,
                maker: trader1
            };

            let trade = {
                amount: 500,
                tradeNonce: 1,
                taker: trader2
            };

            let orderHash = getOrderHash(exchange, order);
            let tradeHash = getTradeHash(orderHash, trade);

            let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

            await exchange.cancelTrade(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: trader2});

            let tradeCanceled = await exchange.traded.call(tradeHash);
            tradeCanceled.should.be.equal(true)
        });

        it('should not execute if not requested by taker of trade', async () => {
            let initialBlockNumber = await web3.eth.getBlockNumber();

            let order = {
                amountBuy: 1000,
                amountSell: 1000,
                expires: initialBlockNumber + 10,
                nonce: 1,
                feeMake: 1e17,
                feeTake: 1e17,
                tokenBuy: token2.address,
                tokenSell: token1.address,
                maker: trader1
            };

            let trade = {
                amount: 500,
                tradeNonce: 1,
                taker: trader2
            };

            let orderHash = getOrderHash(exchange, order);
            let tradeHash = getTradeHash(orderHash, trade);

            let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

            let tradeCancellationResultForOwner = await exchange.cancelTrade.call(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: owner});

            let tradeCancellationResultForOperator = await exchange.cancelTrade.call(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: operator});

            let tradeCancellationResultForAnyUser = await exchange.cancelTrade.call(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: anyUser});

            tradeCancellationResultForOwner.should.be.equal(false);
            tradeCancellationResultForOperator.should.be.equal(false);
            tradeCancellationResultForAnyUser.should.be.equal(false);

            exchange.cancelTrade(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: owner});

            let tradedValueAfterTradeCancelByOwner = await exchange.traded.call(tradeHash);
            tradedValueAfterTradeCancelByOwner.should.be.equal(false);

            exchange.cancelTrade(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: operator});

            let tradedValueAfterTradeCancelByOperator = await exchange.traded.call(tradeHash);
            tradedValueAfterTradeCancelByOperator.should.be.equal(false);

            exchange.cancelTrade(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: anyUser});

            let tradedValueAfterTradeCancelByAnyUser = await exchange.traded.call(tradeHash);
            tradedValueAfterTradeCancelByAnyUser.should.be.equal(false)
        });

        it('should not execute if taker signature is invalid', async () => {
            let initialBlockNumber = await web3.eth.getBlockNumber();

            let order = {
                amountBuy: 1000,
                amountSell: 1000,
                expires: initialBlockNumber + 10,
                nonce: 1,
                feeMake: 1e17,
                feeTake: 1e17,
                tokenBuy: token2.address,
                tokenSell: token1.address,
                maker: trader1
            };

            let trade = {
                amount: 500,
                tradeNonce: 1,
                taker: trader2
            };

            let orderHash = getOrderHash(exchange, order);
            let tradeHash = getTradeHash(orderHash, trade);

            let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader1);

            let tradeCancellationResult = await exchange.cancelTrade.call(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: trader2});

            tradeCancellationResult.should.be.equal(false);

            await exchange.cancelTrade(
                orderHash,
                trade.amount,
                trade.tradeNonce,
                trade.taker,
                v2,
                r2,
                s2,
                {from: trader2});

            let tradeCanceled = await exchange.traded.call(tradeHash);
            tradeCanceled.should.be.equal(false);
        })
    });

    describe('Trading', async () => {
        describe('', async () => {
            beforeEach(async () => {
                weth = await WETH.new();
                exchange = await Exchange.new(weth.address, feeAccount);
                token1 = await Token1.new(trader1, 1000);
                token2 = await Token2.new(trader2, 1000);

                await exchange.setOperator(operator, true, {from: owner});

                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
            });

            it('should execute if trade.amount < order.amountBuy (Token against Token)', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 500,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let balances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                balances.trader1BalanceOfToken1.should.be.bignumber.equal(500);
                balances.trader1BalanceOfToken2.should.be.bignumber.equal(500);
                balances.trader1BalanceOfWETH.should.be.bignumber.equal(9.5e17);
                balances.trader2BalanceOfToken1.should.be.bignumber.equal(500);
                balances.trader2BalanceOfToken2.should.be.bignumber.equal(500);
                balances.trader2BalanceOfWETH.should.be.bignumber.equal(9.5e17);
                balances.feeAccountBalanceOfWETH.should.be.bignumber.equal(1e17)
            });

            it('should execute if trade.amount = order.amountBuy (Token against Token)', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let balances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                balances.trader1BalanceOfToken1.should.be.bignumber.equal(0);
                balances.trader1BalanceOfToken2.should.be.bignumber.equal(1000);
                balances.trader1BalanceOfWETH.should.be.bignumber.equal(9e17);
                balances.trader2BalanceOfToken1.should.be.bignumber.equal(1000);
                balances.trader2BalanceOfToken2.should.be.bignumber.equal(0);
                balances.trader2BalanceOfWETH.should.be.bignumber.equal(9e17);
                balances.feeAccountBalanceOfWETH.should.be.bignumber.equal(2e17)
            });

            it('should not execute if trade.amount > order.amountBuy (Token against Token)', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 500,
                    amountSell: 500,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 600,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);

            });

            it('should execute if trade.amount < order.amountBuy (Token against WETH)', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 5e17,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: weth.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 2.5e17,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let balances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                balances.trader1BalanceOfToken1.should.be.bignumber.equal(500);
                balances.trader1BalanceOfWETH.should.be.bignumber.equal(1.20e18);
                balances.trader2BalanceOfToken1.should.be.bignumber.equal(500);
                balances.trader2BalanceOfWETH.should.be.bignumber.equal(7E17);
                balances.feeAccountBalanceOfWETH.should.be.bignumber.equal(1e17)
            });

            it('should execute if trade.amount = order.amountBuy (Token against WETH)', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 5e17,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: weth.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 5e17,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let balances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                balances.trader1BalanceOfToken1.should.be.bignumber.equal(0);
                balances.trader1BalanceOfWETH.should.be.bignumber.equal(1.4e18);
                balances.trader2BalanceOfToken1.should.be.bignumber.equal(1000);
                balances.trader2BalanceOfWETH.should.be.bignumber.equal(4E17);
                balances.feeAccountBalanceOfWETH.should.be.bignumber.equal(2e17)
            });

            it('should not execute if trade.amount > order.amountBuy (Token against WETH)', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 5e17,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: weth.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 6e17,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if maker signature is invalid', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber - 1,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader2);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if taker signature is invalid', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber - 1,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader1);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if order has expired', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber - 1,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if trade is already completed', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 500,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let trade1Hash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(trade1Hash, privateKeyOfTrader2);

                let orderValuesForTrade1 = getMatchOrderValues(order, trade);
                let orderAddressesForTrade1 = getMatchOrderAddresses(order, trade);

                await exchange.executeTrade(orderValuesForTrade1, orderAddressesForTrade1, [v1, v2], [r1, s1, r2, s2]);

                let balancesBefore = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValuesForTrade1,
                    orderAddressesForTrade1,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValuesForTrade1, orderAddressesForTrade1, [v1, v2], [r1, s1, r2, s2]);

                let balancesAfter = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                balancesAfter.should.be.deep.equals(balancesBefore);
            });

            it('should not execute if trade is already cancelled', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 500,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let trade1Hash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(trade1Hash, privateKeyOfTrader2);

                let orderValuesForTrade1 = getMatchOrderValues(order, trade);
                let orderAddressesForTrade1 = getMatchOrderAddresses(order, trade);

                await exchange.cancelTrade(
                    orderHash,
                    trade.amount,
                    trade.tradeNonce,
                    trade.taker,
                    v2,
                    r2,
                    s2,
                    {from: trader2});

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValuesForTrade1,
                    orderAddressesForTrade1,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                await exchange.executeTrade(orderValuesForTrade1, orderAddressesForTrade1, [v1, v2], [r1, s1, r2, s2]);

                tradeExecutionResult.should.be.equal(false);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if rounding error too large', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 3000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 100,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let trade1Hash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(trade1Hash, privateKeyOfTrader2);

                let orderValuesForTrade1 = getMatchOrderValues(order, trade);
                let orderAddressesForTrade1 = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValuesForTrade1,
                    orderAddressesForTrade1,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });


            it('should not execute if order is already completed', async () => {
                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade1 = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let trade1Hash = getTradeHash(orderHash, trade1);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(trade1Hash, privateKeyOfTrader2);

                let orderValuesForTrade1 = getMatchOrderValues(order, trade1);
                let orderAddressesForTrade1 = getMatchOrderAddresses(order, trade1);

                await exchange.executeTrade(
                    orderValuesForTrade1,
                    orderAddressesForTrade1,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                let balancesBefore = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let trade2 = {
                    amount: 100,
                    tradeNonce: 2,
                    taker: trader2
                };

                let trade2Hash = getTradeHash(orderHash, trade2);

                let {message: message3, messageHash: messageHash3, r: r3, s: s3, v: v3} = web3.eth.accounts.sign(trade2Hash, privateKeyOfTrader2);

                let orderValuesForTrade2 = getMatchOrderValues(order, trade2);
                let orderAddressesForTrade2 = getMatchOrderAddresses(order, trade2);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValuesForTrade2,
                    orderAddressesForTrade2,
                    [v1, v3],
                    [r1, s1, r3, s3]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValuesForTrade2, orderAddressesForTrade2, [v1, v3], [r1, s1, r3, s3]);

                let balancesAfter = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                balancesAfter.should.be.deep.equals(balancesBefore);
            })
        });

        describe('', async () => {
            beforeEach(async () => {
                weth = await WETH.new();
                exchange = await Exchange.new(weth.address, feeAccount);
                token1 = await Token1.new(trader1, 1000);
                token2 = await Token2.new(trader2, 1000)
            });

            it('should not execute if maker does not have enough sellToken balance', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1500, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1500,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if exchange does not have enough sellToken allowance from maker', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 500, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if maker does not have enough WETH to pay maker fees for trade', async () => {
                await weth.deposit({from: trader1, value: 5e16});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if exchange does not have enough WETH allowance from maker to pay maker fee for trade', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, 5e16, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if taker does not have enough buyToken balance', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 1500, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1500,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1500,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if exchange does not have enough buyToken allowance from taker', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 500, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if taker does not have enough WETH to pay taker fees for trade', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: 5e16});
                weth.approve(exchange.address, wrappedEther, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            });

            it('should not execute if exchange does not have enough WETH allowance from taker to pay taker fee for trade', async () => {
                await weth.deposit({from: trader1, value: ether});
                weth.approve(exchange.address, wrappedEther, {from: trader1});

                await weth.deposit({from: trader2, value: ether});
                weth.approve(exchange.address, 5e16, {from: trader2});

                await token1.approve(exchange.address, 1000, {from: trader1});
                await token2.approve(exchange.address, 1000, {from: trader2});

                initialBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);

                let initialBlockNumber = await web3.eth.getBlockNumber();

                let order = {
                    amountBuy: 1000,
                    amountSell: 1000,
                    expires: initialBlockNumber + 10,
                    nonce: 1,
                    feeMake: 1e17,
                    feeTake: 1e17,
                    tokenBuy: token2.address,
                    tokenSell: token1.address,
                    maker: trader1
                };

                let trade = {
                    amount: 1000,
                    tradeNonce: 1,
                    taker: trader2
                };

                let orderHash = getOrderHash(exchange, order);
                let tradeHash = getTradeHash(orderHash, trade);

                let {message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1} = web3.eth.accounts.sign(orderHash, privateKeyOfTrader1);
                let {message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2} = web3.eth.accounts.sign(tradeHash, privateKeyOfTrader2);

                let orderValues = getMatchOrderValues(order, trade);
                let orderAddresses = getMatchOrderAddresses(order, trade);

                let tradeExecutionResult = await exchange.executeTrade.call(
                    orderValues,
                    orderAddresses,
                    [v1, v2],
                    [r1, s1, r2, s2]
                );

                tradeExecutionResult.should.be.equal(false);

                await exchange.executeTrade(orderValues, orderAddresses, [v1, v2], [r1, s1, r2, s2]);

                let currentBalances = await getBalances(trader1, trader2, feeAccount, token1, token2, weth);
                currentBalances.should.be.deep.equals(initialBalances);
            })
        })
    })

});
