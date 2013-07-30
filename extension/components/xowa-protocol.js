
var kSCHEME = "xowa";
var kPROTOCOL_NAME = "Search Protocol";
var kPROTOCOL_CONTRACTID = "@mozilla.org/network/protocol;1?name=" + kSCHEME;
var kPROTOCOL_CID = Components.ID("252ebb45-4342-4f98-9425-f2c3ecb3dbc3");

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;
var nsIProtocolHandler = Ci.nsIProtocolHandler;
var nsIIOService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://xowa_viewer/xowa-interface.jsm");
Components.utils.import("resource://xowa_viewer/logger.jsm");
 

function XowaProtocol() {
}

XowaProtocol.prototype = 
{
    scheme: kSCHEME,
    defaultPort: -1,
    protocolFlags: 
        /*nsIProtocolHandler.URI_DANGEROUS_TO_LOAD | 
        nsIProtocolHandler.URI_LOADABLE_BY_ANYONE | 
        */nsIProtocolHandler.URI_IS_LOCAL_FILE | 
        nsIProtocolHandler.URI_IS_LOCAL_RESOURCE | 
        nsIProtocolHandler.URI_STD /*| 
        nsIProtocolHandler.URI_NOAUTH*/ /*| 
        nsIProtocolHandler.URI_INHERITS_SECURITY_CONTEXT*/ /*|
        nsIProtocolHandler.URI_OPENING_EXECUTES_SCRIPT*/,

    newURI: function(aSpec, aOriginCharset, aBaseURI)
    {
        var uri = Cc["@mozilla.org/network/simple-uri;1"].createInstance(Ci.nsIURI);
        if(aBaseURI === null)      
        {
            uri.spec = aSpec;
        }
        else 
        {
            // var re = /^[^:]+:\/*([^\/]+).*/;
            // var domain =  re.exec(aBaseURI.spec)[1]; // eg in "xowa://simple.wikipedia.org/wiki/Earth" "simple.wikipedia.org" is domain
            // if(aBaseURI.spec[aBaseURI.spec.length-1]=="\\")
                // without_slash = /^(.*)\\*$/
            // var parent_url = "xowa://simple.wikipedia.org/wiki";
            // Logger.log(aSpec);
            // if(aSpec.substr(0,5) == "file:")
            // {
                // Logger.log("bug here");
                // uri.spec = aSpec;
            // }
            // else if(aSpec.substr(0,2) == "//") // protocol scope e.g curr URL = xowa://simple.wikipedia.org/wiki/Earth , url is //en.wikipedia.org/wiki/Earth, then really (absolute) URL will be xowa://en.wikipedia.org/wiki/Earth
            // {
                // uri.spec = kSCHEME + aSpec;
            // }
            // else if(aSpec[0]=="/") // domain scope e.g curr URL = xowa://en.wikipedia.org/wiki/Earth , url is /wiki/Sun, then really (absolute) URL will be xowa://en.wikipedia.org/wiki/Sun
            // {
                // uri.spec = kSCHEME + ":" + domain + aSpec;
            // }
            // else if(aSpec.substr(0,2) =="./") // base url scope e.g curr URL = xowa://en.wikipedia.org/wiki/Earth , url is ./Sun, then really (absolute) URL will be xowa://en.wikipedia.org/wiki/Sun
            // {
                // uri.spec = parent_url + aSpec.substr(1); // change "." to parent_url
            // }
            // else if(aSpec[0]=="#") // bookmark
            // {
                // uri.spec = aBaseURI.spec + aSpec;
            // }
            // else // base url scope e.g curr URL = xowa://en.wikipedia.org/wiki/Earth , url is Sun, then really (absolute) URL will be xowa://en.wikipedia.org/wiki/Sun 
            // {
                // uri.spec = parent_url + "/" + aSpec;
            // }
            // TODO interpreting /../ , <START>../ , /..<END>
            
            
            // Logger.log(aBaseURI.resolve(aSpec)); // BUG : returns aSpec. wtf?
            // uri.spec = aBaseURI.resolve(aSpec); // convert relative uri to absolute
            
            if(aSpec.substr(0, 6) == "/site/") // urls like ""/site/home/wiki/Main Page" are absolute urls to url like "home/wiki/Main Page"
            {
                uri.spec = kSCHEME + ":" + aSpec.substr(6);
            }
            else if(aSpec.substr(0, 5) == "xowa:") // xowa:... means: run xowa insternal command
            {
                uri.spec = kSCHEME + ":" + aSpec.substr(5); // temporary; TODO 
            }
            else
            {
                // resolving relative -> absolute uri - temporary workaraud of resolve() issue
                var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService);
                var base_after_protocol = aBaseURI.spec.substr(kSCHEME.length+1);
                var temp_base = "http:" + (base_after_protocol.substr(0,2)=="//" ?"" :"//") + base_after_protocol;
                var baseURI = ioService.newURI(temp_base, null, null);
                var temp_abs = ioService.newURI(aSpec, null, baseURI).spec;
                uri.spec = "xowa:" + temp_abs.substr("http:".length);
            }
        }
        
        return uri;
    },

    newChannel: function(aURI) // function respons for content of page initiated using xowa protocol
    {
        return new XowaChannel(aURI);
    },
    classDescription: "Xowa Protocol",
    contractID: kPROTOCOL_CONTRACTID,
    classID: Components.ID(kPROTOCOL_CID),
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIProtocolHandler])
};


// inspirated and based on: https://addons.mozilla.org/pl/firefox/files/browse/220262/file/lib/elemHideHitRegistration.js#L88
/* class */ function XowaChannel(_uri)
{
    var systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal); 
    this.owner = systemPrincipal; //TODO - may be unsecure
    
    this.originalURI = this.URI = _uri;
    this.xowa_resource = _uri.spec.substring(_uri.spec.indexOf(":") + 1, _uri.spec.length); // URI syntax "xowa:resource"
}

XowaChannel.prototype =
{
    xowa_resource: null,
    
    URI: null,
    originalURI: null,
    contentCharset: "UTF-8",
    contentLength: 0,
    contentType: "text/html",//"application/vnd.mozilla.xul+xml"
    owner: null,
    securityInfo: null,
    notificationCallbacks: null,
    loadFlags: 0,
    loadGroup: null,
    name: null,
    status: Cr.NS_OK,

    asyncOpen: function(_listener, _context)
    {debugger;
        Logger.log("Protocol :: Trying get "+this.xowa_resource);
        
        var this_channel = this;
        
        _listener.onStartRequest(/* nsIRequest */ this, _context);
        
        var session = Xowa.new_session();
        session.init();
        var xowa_cmd = "app.shell.fetch_page('"+this.xowa_resource+"', 'html');"; // POT. TODO: it is weak for xowa commands injections
        session.run_xowa_cmd_async(xowa_cmd,"xowa.cmd.exec", 
        function(_result, _result_type, _connection_status) 
        {
            var in_stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
            var page_source;
            
            switch(_connection_status)
            {
            case "EXCHANGE_END":
                switch(_result_type)
                {
                case "xowa.cmd.result":
                    page_source = _result;
                    break;
                case "xowa.cmd.error":  // TODO
                    Logger.error("Xowa returned error "+_result+" after run "+xowa_cmd);
                    page_source = "Xowa returned error "+_result+" after run "+xowa_cmd;
                    break;
                }
                break;
            case "TIME_OUT": //TODO
                page_source = "Connection time out.";
                break;
            case "SERVER_NOT_RUNNING": //TODO
                page_source = "Server is not running.";
                break;
            case "UNKNOWN_HOST":
                page_source = "Unknown host. Probably wrong XOWA server host is set (check extensions.xowa_viewer.xowa_server_host in about:config)";
                break;
            default:
                page_source = String(_connection_status);
                break;
            }
            
            in_stream.setData(page_source, page_source.length);
            _listener.onDataAvailable(/* nsIRequest */ this_channel, _context, in_stream, 0, in_stream.available());
            _listener.onStopRequest(/* nsIRequest */ this_channel, _context, Cr.NS_OK);
        });
    },

    /* sync */ open: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    isPending: function()
    {
        return false;
    },
    cancel: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    suspend: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    resume: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};



if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([XowaProtocol]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([XowaProtocol]);
