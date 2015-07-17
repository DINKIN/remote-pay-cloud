/**
 * Library to facilitate OAuth authentication.
 *
 * All of the Clover rest calls will require that the application has an oauth token.  This
 * object makes obtaining and using a token clearer.
 *
 * @param configuration - an object of the form
 *  {
 *      "clientId": the_id_for_your_clover_application, // required
 *      "domain" : the_clover_server_url // if unset, defaulted to CloverOAuth.defaultDomain
 *  }
 * @constructor sets up the object, and may throw an error if the clientId is not present on the
 *      passed configuration.
 */

function CloverOAuth(configuration) {

    /**
     * Attempt to get the security token
     * This function attempts to extract an OAuth token from the
     * request/response.
     * It will create/set the userInfo object with associated keys.
     */
    this.getAccessToken = function() {
        this.parseTokens();
        var token = this.userInfo[CloverOAuth.accessTokenKey];
        if (token == null) {
            this.redirect();
        }
        return token;
    }


    /**
     *
     */
    this.parseTokens = function() {
        if(!this["userInfo"]) {
            this.userInfo = {};
            var params = window.location.hash.split('&');
            var i = 0;
            while (param = params[i++]) {
                param = param.split("=");
                this.userInfo[param[0]] = param[1];
            }
        }
    }

    /**
     * Redirect the application to the proper site to do the oauth process.  Once
     * a security token has been obtained, the site will be reloaded with the oauth token set in the
     * request (as a parameter).
     */
    this.redirect = function() {
        var redirect = window.location.href.replace(window.location.hash, '');
        var url = this.configuration.domain +
            CloverOAuth.oauthTokenURLFragment_0 + this.configuration.clientId +
            CloverOAuth.oauthTokenURLFragment_1 + encodeURIComponent(redirect);
        window.location.href = url;
    }

    /**
     * Grab the parameters from the url string.
     */
    this.getURLParams = function() {
        var urlParamMap = {};
        var params = window.location.search.substr(1).split('&');

        for (var i = 0; i < params.length; i++) {
            var p = params[i].split('=');
            urlParamMap[p[0]] = decodeURIComponent(p[1]);
        }
        return urlParamMap;
    }

    /**
     *
     * @returns {boolean} true if the token is set
     */
    this.hasToken = function() {
        this.parseTokens();
        var nullUI = this.userInfo==null;
        if(!nullUI) var noToken = this.userInfo[CloverOAuth.accessTokenKey];
        return nullUI || noToken;
    }

    this.setConfiguration = function() {
        // Check the configuration for completeness, default the doamin if needed.
        if(configuration) {
            if(!configuration.clientId){
                configuration.clientId = this.getURLParams("client_id");
                if(!configuration.clientId) {
                    var error = new Error("Configuration with clientId required for CloverOAuth creation.");
                    throw error;
                }
            } else if(!configuration.domain){
                configuration.domain = CloverOAuth.defaultDomain;
            }
            this.configuration = configuration;
        }
        else {
            var error = new Error("Configuration required for CloverOAuth creation.");
            throw error;
        }
    }

    this.setConfiguration(configuration);
}

CloverOAuth.defaultDomain = "http://www.clover.com/";
CloverOAuth.oauthTokenURLFragment_0 = 'oauth/authorize?response_type=token&client_id=';
CloverOAuth.oauthTokenURLFragment_1 = '&redirect_uri=';
CloverOAuth.accessTokenKey = '#access_token';