/**
 * Clover API for external Systems
 *
 * @param {CloverConfig} configuration - the device that sends and receives messages
 * @constructor
 */
function Clover(configuration) {

    this.device = new WebSocketDevice();
    this.device.messageBuilder = new RemoteMessageBuilder("com.clover.remote.protocol.lan");
    // Echo all messages sent and received.
    this.device.echoAllMessages = false;

    this.configuration = configuration;

    this.payIntentTemplate =  {
        "action": "com.clover.remote.protocol.action.START_REMOTE_PROTOCOL_PAY",
        "transactionType": "PAYMENT",
        // "transactionNo": 300010,
        "taxAmount": 0, // tax amount is included in the amount
        "cardEntryMethods": CardEntryMethods.ALL
    };

    //****************************************
    // Very useful for debugging
    //****************************************
    this.device.on(WebSocketDevice.ALL_MESSAGES,
        function (message) {
            if (message['type'] != 'PONG') {
                console.log(message);
            }
        }
    );

    /**
     *  The deviuce connection is NOT made on completion of this call.  The device connection
     *  will be made once the WebSocketDevice.onopen is called.
     */
    this.initDeviceConnection = function () {
        if (this.configuration.deviceURL) {
            // We have the device url, contact the device
            this.contactDevice();
        } else {
            // Otherwise we must have the oauth token to get the information we need at the very least.
            // Either we already have it...
            if (this.configuration.oauthToken) {
                // We need the access token, the domain and the merchantId in order to get the devices
                // We already know that we have the token, but we need to check for the
                // domain and merchantId.
                if (this.configuration.domain && this.configuration.merchantId) {
                    // We need the device id of the device we will contact.
                    // Either we have it...
                    var xmlHttpSupport = new XmlHttpSupport();
                    var inlineEndpointConfig = {"configuration" : {}};
                    var me = this;
                    inlineEndpointConfig.getAccessToken = function () {
                        return me.configuration.oauthToken;
                    };
                    inlineEndpointConfig.configuration.domain = this.configuration.domain;
                    var endpoints = new Endpoints(inlineEndpointConfig);

                    if (this.configuration.deviceId) {
                        var noDashesDeviceId = this.configuration.deviceId.replace(/-/g, "");
                        // this is the uuid for the device
                        var xmlHttpSupport = new XmlHttpSupport();
                        // This is the data posted to tell the server we want to create a connection
                        // to the device
                        var deviceContactInfo = {
                            deviceId: noDashesDeviceId,
                            isSilent: true
                        };

                        xmlHttpSupport.postData(endpoints.getAlertDeviceEndpoint(this.configuration.merchantId),
                            function (data) {
                                // The format of the data received is:
                                //{
                                //    'host': web_socket_host,
                                //    'token': token_to_link_to_the_device
                                //}
                                // Use this data to build the web socket url
                                var url = data.host + '/support/cs?token=' + data.token;
                                me.device.messageBuilder = new RemoteMessageBuilder(
                                    "com.clover.remote.protocol.websocket");

                                console.log("Server responded with information on how to contact device. " +
                                    "Opening communication channel...");

                                // The response to this will be reflected in the device.onopen method (or on error),
                                // That function will attempt the discovery.
                                me.configuration.deviceURL = url;
                                //recurse
                                me.initDeviceConnection();
                            },
                            function (error) {
                                console.log(error);
                            }, deviceContactInfo
                        );

                    } else if(this.configuration.deviceSerialId){
                        // or we need to go get it.  This is a little hard, because the merchant
                        // can have multiple devices.

                        // If there are multiple devices, we need to know which device the user wants
                        // to use.  They can pass the 'serial' number of the device, or a 0 - based index
                        // for the devices, which assumes they know what order the device list will be
                        // returned in.
                        var url = endpoints.getDevicesEndpoint(this.configuration.merchantId);

                        xmlHttpSupport.getData(url,
                            function(devices) {
                                me.handleDevices(devices);
                                // serial' number of the device
                                me.configuration.deviceId =
                                    me.deviceBySerial[me.configuration.deviceSerialId].id;
                                // recurse
                                me.initDeviceConnection();
                            }
                            ,console.log
                        );
                    } else {
                        //Nothing left to try.  Error out.
                        throw new Error("Cannot determine what device to use for connection." +
                            "  You must provide the configuration.deviceId, or the serial number" +
                            " of the device. " +
                            " You can find the device serial number using the device. Select " +
                            "'Settings > About (Station|Mini|Mobile) > Status', select 'Status' and " +
                            "look for 'Serial number' in the list displayed.");
                    }
                } else {
                    // We do not have enough info to initialize.  Error out
                    throw new Error("Incomplete init info.");
                }
            } else {
                // or we need to go get it.
                // If we need to go get it, then we will need the clientId
                // and the domain
                if (this.configuration.clientId && this.configuration.domain) {
                    this.cloverOAuth = new CloverOAuth(this.configuration);
                    // This may cause a redirect
                    this.configuration.oauthToken = this.cloverOAuth.getAccessToken();
                    // recurse
                    this.initDeviceConnection();
                }
            }
        }
    }

    /**
     * Display a set of devices
     * @private
     * @param devicesVX
     */
    this.handleDevices = function(devicesVX) {
        var devices = null;
        this.deviceBySerial = {};
        // depending on the version of the call, the devices might be in a slightly different format.
        // We would need to determine what devices were capable of doing what we want.  This means we
        // need to know if the device has the websocket connection enabled.  The best way to do this is
        // to make a different REST call, but we could filter the devices here.
        if (devicesVX.hasOwnProperty('devices')) {
            devices = devicesVX.devices;
        }
        else if (devicesVX.hasOwnProperty('elements')) {
            devices = devicesVX.elements;
        }
        var i;
        for (i = 0; i < devices.length; i++) {
            this.deviceBySerial[devices[i].serial] = devices[i];
        }
    }

    /**
     * @private
     */
    this.contactDevice = function () {
        var me = this;

        this.device.on(LanMethod.DISCOVERY_RESPONSE,
            function (message) {
                // This id is set when the discovery request is sent when the device 'onopen' is called.
                clearInterval(me.device.discoveryTimerId);
                console.log("Device has responded to discovery message.");
                console.log(message);
            }
        );

        this.device.onopen = function () {
            // The connection to the device is open, but we do not yet know if there is anyone at the other end.
            // Send discovery request messages until we get a discovery response.
            me.device.dicoveryMessagesSent = 0;
            me.device.discoveryTimerId =
                setInterval(
                    function () {
                        console.log("Sending 'discovery' message to device.");
                        me.device.sendMessage(me.device.messageBuilder.buildDiscoveryRequest());
                        me.device.dicoveryMessagesSent++;

                        // Arbitrary decision that 10 messages is long enough to wait.
                        if (me.device.dicoveryMessagesSent > 10) {
                            console.log("Something is wrong.  we are getting pong messages, but no discovery response." +
                                "  Shutting down the connection.");
                            me.device.disconnectFromDevice();
                            clearInterval(me.device.discoveryTimerId);
                        }
                    }, 3000
                );
            console.log('device opened');
            console.log("Communication channel open.");
        }
        console.log("Contacting device at " + this.configuration.deviceURL);
        this.device.contactDevice(this.configuration.deviceURL);
    }

    /**
     *
     */
    this.notifyWhenDeviceIsReady = function(tellMeWhenDeviceIsReady) {
        this.device.once(LanMethod.DISCOVERY_RESPONSE, tellMeWhenDeviceIsReady);
    }

    /**
     * Sale AKA purchase
     *
     * @param {SaleRequest} saleInfo - the information for the sale
     * @param {SaleResponse} saleRequestCallback - the callback that receives the sale completion information.  Two parameters
     *  will be passed to this function: if the payment succeeded, the first will be true, and the second will
     *  be the payment information;  if the payment failed, the first parameter will be false.
     */
    this.sale = function (saleInfo, saleRequestCallback) {
        var payIntent = this.payIntentTemplate;
        // Do verification of parameters
        if (!saleInfo.hasOwnProperty("amount") || !isInt(saleInfo["amount"])) {
            throw new Error("paymentInfo must include 'amount', and the value must be an integer");
        }
        if (!saleInfo.hasOwnProperty("tipAmount")) {
            saleInfo["tipAmount"] = 0;
        } else if (!isInt(saleInfo["tipAmount"])) {
            throw new Error("if paymentInfo has 'tipAmount', the value must be an integer");
        }
        if (saleInfo.hasOwnProperty("employeeId")) {
            payIntent.employeeId = saleInfo["employeeId"];
        }
        if (saleInfo.hasOwnProperty("orderId")) {
            payIntent.orderId = saleInfo["orderId"];
        }
        payIntent.amount = saleInfo["amount"];
        payIntent.tipAmount = saleInfo["tipAmount"];

        var me = this;
        var signature = null;
        //Wire in the handler for completion to be called once.
        /**
         * Wire in automatic signature verification for now
         */
        this.device.once(LanMethod.VERIFY_SIGNATURE,
            function (message) {
                var payload = JSON.parse(message.payload);
                var payment = JSON.parse(payload.payment);
                // Already an object...hmmm
                signature = payload.signature;
                me.device.sendSignatureVerified(payment);
            }
        );
        this.device.once(LanMethod.FINISH_OK,
            function (message) {
                var payload = JSON.parse(message.payload);
                var payment = JSON.parse(payload.payment);
                var callBackPayload = {};
                callBackPayload.payment = payment;
                callBackPayload.signature = signature;
                callBackPayload.result = payment.result;

                saleRequestCallback(true, callBackPayload);
                me.device.sendShowWelcomeScreen();
            }
        );
        this.device.once(LanMethod.FINISH_CANCEL,
            function (message) {
                var callBackPayload = {};
                callBackPayload.result = "CANCEL";
                saleRequestCallback(false, callBackPayload);
                me.device.sendShowWelcomeScreen();
            }
        );
        this.device.sendTXStart(payIntent);
    }

    /**
     *
     * @param {Object} payment - the payment information returned from a call to 'sale'
     * @param {requestCallback} completionCallback - TODO: the callback that receives the sale completion information.
     *  Two parameters
     *  will be passed to this function: if the void succeeded, the first will be true, and the second will
     *  be any additional information;  if the void failed, the first parameter will be false.
     */
    this.voidTransaction = function (payment, completionCallback) {

        // TODO: Add ACK callback to void.

        device.sendPaymentVoid(payment);
    }

    /**
     * Print an array of strings on the device
     *
     * @param {string[]} textLines - an array of strings to print
     */
    this.print = function (textLines) {
        device.sendPrintText(textLines);
    }

    /**
     * Not yet implemented
     */
    this.printReceipt = function () {
        throw new Error("Not yet implemented");
    }

    /**
     * Not yet implemented
     */
    this.printImage = function (img) {
        throw new Error("Not yet implemented");
    }

    /**
     * Not yet implemented
     */
    this.saleWithCashback = function () {
        throw new Error("Not yet implemented");
    }

    /**
     * Not yet implemented
     */
    this.refund = function () {
        throw new Error("Not yet implemented");
    }

    //////////

    //
    //
    ///**
    // * Not yet implemented
    // */
    //this.preAuth = function() {
    //    throw new Error("Not yet implemented");
    //};
    ///**
    // * Not yet implemented
    // */
    //this.authorize = this.preAuth
    //
    ///**
    // * Not yet implemented
    // */
    //this.adjustAuth = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.tipAdjust = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.manualRefund = function() {
    //    throw new Error("Not yet implemented");
    //}
    ///**
    // * Not yet implemented
    // */
    //this.closeout = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.getSiteTotals = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.displayMessage = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.cancelTxn = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.rebootDevice = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.echo = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.balance = function() {
    //    throw new Error("Not yet implemented");
    //}
    //
    ///**
    // * Not yet implemented
    // */
    //this.getCardData = function() {
    //    throw new Error("Not yet implemented");
    //}
}

/**
 * @private
 * @param value
 * @returns {boolean}
 */
function isInt(value) {
    var x;
    if (isNaN(value)) {
        return false;
    }
    x = parseFloat(value);
    return (x | 0) === x;
}


/**
 * This callback type is called `requestCallback` and is displayed as a global symbol.
 *
 * @callback requestCallback
 * @param {boolean} success
 * @param {Object} [responseData]
 */

/**
 * A payment
 *
 * @typedef {Object} SaleRequest
 * @property {integer} amount - the amount of a sale, including tax
 * @property {integer} [tipAmount] - the amount of a tip.  Added to the amount for the total.
 * @property {string} orderId - an id for this sale
 * @property {string} [employeeId] - the valid Clover id of an employee recognized by the device.  Represents the
 *  employee making this sale.
 */

/**
 * The response to a sale
 *
 * @typedef {Object} SaleResponse
 * @property {string} result - the result code for the transaction - "SUCCESS", "CANCEL"
 * @property {Payment} payment - the payment information
 * @property {Signature} signature - the signature, if present
 */

/**
 * The callback on a sale
 *
 * @callback saleRequestCallback
 * @param {boolean} success
 * @param {SaleResponse} [responseData]
 */

/**
 * @typedef {Object} Payment
 * @property {string} result - the result code for the transaction - "SUCCESS", "CANCEL"
 * @property {integer} [createdTime] - the time in milliseconds that the transaction successfully completed
 * @property {CardTransaction} [cardTransaction] - successful transaction information
 * @property {integer} [amount] - the amount of the transaction, including tax
 * @property {integer} [tipAmount] - added tip amount
 * @property {Object} [order] - order information. Ex: id - the order id
 * @property {Object} [employee] - employee information. Ex: id - the employee id
 */

/**
 * @typedef {Object} CardTransaction
 * @property {integer} authcode - the authorization code
 * @property {string} entryType - SWIPED, KEYED, VOICE, VAULTED, OFFLINE_SWIPED, OFFLINE_KEYED, EMV_CONTACT,
 *  EMV_CONTACTLESS, MSD_CONTACTLESS, PINPAD_MANUAL_ENTRY
 * @property {Object} extra - additional information on the transaction.  EX: cvmResult - "SIGNATURE"
 * @property {string} state - PENDING, CLOSED
 * @property {string} referenceId
 * @property {string} type - AUTH, PREAUTH, PREAUTHCAPTURE, ADJUST, VOID, VOIDRETURN, RETURN, REFUND,
 *  NAKEDREFUND, GETBALANCE, BATCHCLOSE, ACTIVATE, BALANCE_LOCK, LOAD, CASHOUT, CASHOUT_ACTIVE_STATUS,
 *  REDEMPTION, REDEMPTION_UNLOCK, RELOAD
 * @property {integer} transactionNo
 * @property {integer} last4 - the last 4 digits of the card
 * @property {string} cardType - VISA, MC, AMEX, DISCOVER, DINERS_CLUB, JCB, MAESTRO, SOLO, LASER,
 *  CHINA_UNION_PAY, CARTE_BLANCHE, UNKNOWN, GIFT_CARD, EBT
 *
 */

/**
 * @typedef {Object} Signature
 * @property {Stroke[]} strokes - the strokes of the signature.  A series of points representing a single contiguous
 *  line
 * @property {integer} height - the pixal height of the canvas area needed to correctly represent the signature
 * @property {integer} width - the pixal width of the canvas area needed to correctly represent the signature
 *
 */

/**
 * @typedef {Object} Stroke - A series of points representing a single contiguous line
 * @property {Point[]} points
 */

/**
 * @typedef {Object} Point
 * @property {integer} x - the x coordinate location of the point in pixals
 * @property {integer} y - the y coordinate location of the point in pixals
 */


/**
 * The configuration for the Clover api object.  This encapsulates the different ways that the Clover object can
 * be configured for proper access to the device.
 *
 * <p>
 *     Possible configurations:<br/>
 *     <ol>
 *          <li>deviceURL (Only valid when device is in Local Pay Display app configuration)</li>
 *          <li>oauthToken, domain, merchantId, deviceId</li>
 *          <li>oauthToken, domain, merchantId, deviceSerialId</li>
 *          <li>clientId, domain, merchantId, deviceId (Requires log in to Clover server)</li>
 *          <li>clientId, domain, merchantId, deviceSerialId (Requires log in to Clover server)</li>
 *     </ol>
 * </p>
 *
 * @typedef CloverConfig
 * @property {string} [deviceURL] - the web socket url to use when connecting to the device.  Optional
 *  if other configuration values allow this to be obtained.
 * @property {string} [oauthToken] - the authentication token used when communicating with the clover cos
 *  server.  Required if deviceURL is not set. Optional if other configuration values allow this
 *  to be obtained.
 * @property {string} [domain] - the url to the clover cos server.
 * @property {string} [merchantId] - the merchant id.
 * @property {string} [deviceId] - the unique device identifier for the merchant device.  This identifies
 *  the device that will be used
 * @property {string} [deviceSerialId] - the serial id of the device to use.
 * @property {string} [clientId] - the Clover application id to use when obtaining the oauth token.
 *
 */
