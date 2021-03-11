const express = require('express');
const Bid = require('../model/Bid');
const Customer = require('../model/Customer');
const Product = require('../model/Product');
const Seller = require('../model/Seller');
const Cart = require('../model/Cart');
const expressAsyncHandler = require("express-async-handler");
const biddingRouter = express.Router();
const nodemailer = require("nodemailer");
const _ = require('lodash');
const env = require("dotenv").config();

biddingRouter.post(
    '/getinitialbestseller',
    expressAsyncHandler(async (req,res)=>{
        try{
            const cart = await Cart.findOne({customerId: req.body.id});
            if(cart){
                const itemList = cart.itemList;
                const city = req.body.city;
                const sellers = await Seller.find({city: city});
                var sellerList = [];
                var priceMap = new Map();
                sellers.forEach(seller=>{
                    sellerList.push(seller._id.toString());
                    priceMap.set(seller._id.toString(),0);
                })
                for(var i=0;i<itemList.length;i++){
                    const item = itemList[i];
                    const product = await Product.findById(item.productId);
                    const sellerMap = product.Sellers;
                    var eligibleSellers = [];
                    sellerList.forEach(seller=>{
                        if(sellerMap.has(seller)){
                            if(sellerMap.get(seller).Quantity >= item.Quantity){
                                eligibleSellers.push(seller);
                                priceMap.set(seller,priceMap.get(seller)+Number(item.Quantity)*Number(sellerMap.get(seller).SellerPrice));
                            }
                        }
                    });
                    console.log("1",eligibleSellers)
                    sellerList = _.intersection(sellerList,eligibleSellers);
                    console.log("2",sellerList)
                }
                console.log(priceMap)
                var minPrice=Number.MAX_SAFE_INTEGER,minSeller=undefined;
                for(var i=0;i<sellerList.length;i++){
                    if(priceMap.get(sellerList[i])<minPrice){
                        minPrice=priceMap.get(sellerList[i]);
                        minSeller=sellerList[i];
                    }
                }
                if(minSeller!==undefined){
                    const sellerDetails = await Seller.findById(minSeller);
                    const allProducts = await Product.find({});
                    var itemDetails = [];
                    for(var i=0;i<itemList.length;i++){
                        const item = allProducts.find(data=>String(data._id)==String(itemList[i].productId));
                        console.log(itemList[i].productId)
                        itemDetails.push({
                            id: itemList[i].productId,
                            name: item.Name,
                            category: item.Category,
                            image: item.Sellers.get(minSeller).Image,
                            minPrice: item.Sellers.get(minSeller).SellerPrice,
                            quantity: itemList[i].Quantity,
                            totalPrice: Number(item.Sellers.get(minSeller).SellerPrice)*Number(itemList[i].Quantity)
                        });
                    }
                    
                    return res.status(200).send({
                        message: "Success",
                        minPrice: minPrice,
                        itemDetails: itemDetails,
                        seller: {
                            sellerId: minSeller,
                            firstName: sellerDetails.firstName,
                            lastName: sellerDetails.lastName,
                            address: sellerDetails.address,
                            city: sellerDetails.city,
                            interest: sellerDetails.category,
                            image: sellerDetails.profilePictureUrl
                        }
                    })
                }else{
                    return res.status(404).send({message: "No seller available"});
                }
            }else{
                return res.status(404).send({message:"Cart empty"});
            } 
            
        }catch(err){
            console.log("Internal server error\n",err);
            return res.status(500).send({message: "Internal server error"});
        }
    })
)

biddingRouter.post(
    "/getotp",
    expressAsyncHandler(async (req,res)=>{
        try{
            const customer = await Customer.findById(req.body.customerId);
        
            //GENERATING A 6 DIGIT OTP
            var digits = "0123456789";
            let OTP = "";
            for (let i = 0; i < 6; i++) {
                OTP += digits[Math.floor(Math.random() * 10)];
            }

            //SENDING OTP TO GIVEN EMAIL USING NODE-MAILER
            let transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                user: process.env.COMPANY_EMAIL,
                pass: process.env.COMPANY_PASSWORD,
                },
            });

            let mailOptions = {
                from: process.env.COMPANY_EMAIL,
                to: customer.email,
                subject: "One Time Password for email verification",
                text: `Welcome to Lococart...You are just one step away from placing your order.
                    Your OTP is ${OTP}. Just Enter this OTP on the email verification screen`,
            };

            transporter.sendMail(mailOptions, function (err, data) {
                if (err) {
                console.log("Error :", err);
                } else {
                console.log("OTP Email sent successfully");
                }
            });
            res.status(200).send({message: "Success", otp:OTP});
        }catch(err){
            console.log("Internal server error\n",err);
            return res.status(500).send({message: "Internal server error"});
        }
    })
)

biddingRouter.post(
    '/placeorder',
    expressAsyncHandler(async (req,res)=>{
        try{
            const customerId = req.body.customerId;
            const sellerId = req.body.initialSellerId;
            const price = req.body.price;
            const itemList = req.body.itemList;
            const addressLine1 = req.body.addressLine1;
            const addressLine2 = req.body.addressLine2;
            const city = req.body.city;

            const bid = new Bid({
                customerId: customerId,
                initialSellerId: sellerId,
                initialPrice: price,
                itemList: itemList,
                addressLine1: addressLine1,
                addressLine2: addressLine2,
                city: city,
                bids: [{
                    biddingPrice: price,
                    sellerId: sellerId
                }],
                orderedAt: Date.now()
            });

            const createdBid = await bid.save();

            var updateCart = await Cart.findOne({customerId: customerId});
            updateCart.itemList=[];
            updateCart.save();

            return res.status(200).send({message: "Success", createdBid: createdBid});
        }catch(err){
            console.log("Internal server error\n",err);
            return res.status(500).send({message: "Internal server error"});
        }
    })
);

biddingRouter.post(
    '/getactivebids',
    expressAsyncHandler(async (req,res)=>{
        try{
            const seller = await Seller.findById(req.body.id);
            const allProducts = await Product.find({});
            const city = seller.city;
            var bids = await Bid.find({city:city});
            bids = bids.filter(bid=>(Date.now()-bid.orderedAt)/(1000*60)<180)
            var bidItems = [];
            bids.forEach(bid=>{
                var allItems = [];
                bid.itemList.forEach(item=>{
                    const product = allProducts.find(product=>String(product._id)==String(item.itemId));
                    console.log(product)
                    allItems.push({
                        name: product.Name,
                        quantity: item.quantity
                    })
                })
                bidItems.push(allItems)
            })
            return res.status(200).send({message: "Success",bids: bids, bidItems: bidItems});
        }catch(err){
            console.log("Internal server error\n",err);
            return res.status(500).send({message: "Internal server error"});
        }
    })
)

biddingRouter.post(
    '/placebid',
    expressAsyncHandler(async (req,res)=>{
        try{
            console.log(req.body)
            console.log("adsds")
            const price = req.body.price;
            const sellerId = req.body.sellerId;
            const bid = await Bid.findById(req.body.bidId);
            if((Date.now() - bid.orderedAt)/(1000*60)<180){
                if(price < bid.bids[bid.bids.length-1].biddingPrice){
                    const seller = await Seller.findById(sellerId);
                    console.log(seller);
                    if(seller){
                        const bidItems = bid.itemList;
                        console.log(bidItems)
                        for(var i=0;i<bidItems.length;i++){
                            const product = await Product.findById(bidItems[i].itemId);
                            const sellerMap = product.Sellers;
                            if(sellerMap.has(sellerId)){
                                if(Number(sellerMap.get(sellerId).Quantity) < Number(bidItems[i].quantity)){
                                    return res.status(200).send({message:"Insufficient item availability from the seller side"});
                                }
                            }else{
                                return res.status(200).send({message:"Insufficient item availability from the seller side"});
                            }
                        }
                        const bidsArray = bid.bids;
                        bidsArray.push({
                            biddingPrice: price,
                            sellerId: sellerId
                        });
                        const updatedBid = await Bid.updateOne({_id: req.body.bidId},
                            {
                                $set:{
                                    bids: bidsArray
                                }
                            });
                        return res.status(200).send({message: "Success", updatedBid: updatedBid});
                    }else{
                        return res.status(404).send({message: "Seller not found"})
                    }
                }else{
                    return res.status(200).send({message: "Please enter an amount lower than the current lowest bid"});
                }
            }else{
                return res.status(200).send({message: "Bidding period expired"});
            }
        }catch(err){
            console.log("Internal server error\n",err);
            return res.status(500).send({message: "Internal server error"});
        }
    })
);

biddingRouter.post(
    '/:id',
    expressAsyncHandler(async (req,res)=>{
        try{
            const bid = await Bid.findById(req.params.id);
            const allSellers = await Seller.find({});
            const seller = allSellers.find(data=>String(data._id)==String(req.body.sellerId));
            console.log(req.body)
            if(seller){
                if(bid){
                    if(bid.city == seller.city){
                        const allProducts = await Product.find({});
                        console.log(bid)
                        var resProducts = [];
                        var resSellers = [];
                        for(var i=0;i<bid.itemList.length;i++){
                            const product = allProducts.find(p=>String(p._id)==String(bid.itemList[i].itemId));
                            resProducts.push({
                                name: product.Name,
                                category: product.Category,
                                quantity: bid.itemList[i].quantity,
                                image: product.Sellers.get(String(bid.initialSellerId)).Image,
                            });
                        }
                        for(var i=bid.bids.length-1;i>=0;i--){
                            const seller = allSellers.find(s=>String(s._id)==String(bid.bids[i].sellerId));
                            resSellers.push({
                                name: seller.firstName + " " + seller.lastName,
                                image: seller.profilePictureUrl,
                                biddingPrice: bid.bids[i].biddingPrice
                            });
                        }
                        return res.status(200).send({message:"Success",bid: bid,products: resProducts, sellers: resSellers});
                    }else{
                        return res.status(400).send({message:"Seller city not within bidding zone"})
                    }
                    
                }else{
                    return res.status(404).send({message:"Could not find the requested resource"});
                }
            }else{
                return res.status(404).send({message:"Invalid seller"});
            }
            
        }catch(err){
            console.log("Internal server error\n",err);
            return res.status(500).send({message: "Internal server error"});
        }
    })
);

module.exports = biddingRouter;